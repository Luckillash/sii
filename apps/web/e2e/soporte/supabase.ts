// Acceso de servicio a Supabase para la e2e del flujo crítico: SOLO para confirmar el
// correo de la cuenta de prueba y para borrar todo lo que la prueba crea. La base es
// producción (no hay otra), así que todo lo de la prueba lleva el prefijo
// `e2e-flujo-` (slug y nombre de la organización, correo de la cuenta) y se borra al
// terminar, pase o falle la prueba, y también lo que haya dejado una corrida anterior.
//
// Lee `apps/web/.env.local` sin cargarlo en `process.env` (el `next dev` de la prueba lo
// carga por su cuenta). Nunca imprime claves.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const PREFIJO = 'e2e-flujo-';
/** Bandeja de prueba de Resend: simula la entrega sin afectar la reputación del dominio. */
export const DOMINIO_CORREO = 'resend.dev';
export const BUCKET_DOCUMENTOS = 'documentos-xml';

/** `delivered+<id>@resend.dev`: el correo de la cuenta de prueba `id`. */
export function correoDePrueba(id: string): string {
  return `delivered+${id}@${DOMINIO_CORREO}`;
}

function esCorreoDePrueba(correo: string | undefined): boolean {
  return (
    typeof correo === 'string' &&
    correo.startsWith(`delivered+${PREFIJO}`) &&
    correo.endsWith(`@${DOMINIO_CORREO}`)
  );
}

let cliente: SupabaseClient | undefined;

export function clienteServicio(): SupabaseClient {
  if (cliente) return cliente;
  const ruta = join(dirname(fileURLToPath(import.meta.url)), '../../.env.local');
  const env = parseEnv(readFileSync(ruta, 'utf8'));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = env.SUPABASE_SECRET_KEY;
  if (!url || !clave) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en apps/web/.env.local.',
    );
  }
  cliente = createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } });
  return cliente;
}

/** Busca la cuenta de prueba por correo (sin crear nada). */
export async function buscarUsuario(correo: string): Promise<{ id: string } | null> {
  const admin = clienteServicio().auth.admin;
  for (let pagina = 1; pagina <= 50; pagina++) {
    const { data, error } = await admin.listUsers({ page: pagina, perPage: 200 });
    if (error) throw new Error(`No se pudo listar usuarios: ${error.message}`);
    const usuario = data.users.find((u) => u.email === correo);
    if (usuario) return { id: usuario.id };
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Confirma el correo de una cuenta de prueba (el enlace del correo no se puede abrir). */
export async function confirmarCorreo(correo: string): Promise<void> {
  if (!esCorreoDePrueba(correo)) throw new Error('Solo se confirman cuentas de prueba.');
  const usuario = await buscarUsuario(correo);
  if (!usuario) throw new Error('La cuenta de prueba no existe.');
  const { error } = await clienteServicio().auth.admin.updateUserById(usuario.id, {
    email_confirm: true,
  });
  if (error) throw new Error(`No se pudo confirmar el correo: ${error.message}`);
}

async function borrarCarpeta(supabase: SupabaseClient, carpeta: string): Promise<number> {
  const { data, error } = await supabase.storage
    .from(BUCKET_DOCUMENTOS)
    .list(carpeta, { limit: 1000 });
  if (error) throw new Error(`No se pudo listar Storage: ${error.message}`);
  let borrados = 0;
  const archivos: string[] = [];
  for (const item of data ?? []) {
    const ruta = `${carpeta}/${item.name}`;
    // Las carpetas vienen sin id.
    if (item.id === null) borrados += await borrarCarpeta(supabase, ruta);
    else archivos.push(ruta);
  }
  if (archivos.length > 0) {
    const r = await supabase.storage.from(BUCKET_DOCUMENTOS).remove(archivos);
    if (r.error) throw new Error(`No se pudo borrar de Storage: ${r.error.message}`);
    borrados += archivos.length;
  }
  return borrados;
}

export interface ResultadoLimpieza {
  organizaciones: number;
  usuarios: number;
  archivos: number;
}

/**
 * Borra TODO lo de prueba: las organizaciones `e2e-flujo-*` (la cascada se lleva
 * empresas, certificados y CAF con sus secretos de Vault por `trg_borrar_secretos`,
 * documentos, envíos, operaciones…), sus archivos de Storage y las cuentas
 * `delivered+e2e-flujo-*@resend.dev`. Idempotente.
 */
export async function limpiar(): Promise<ResultadoLimpieza> {
  const supabase = clienteServicio();
  const { data: orgs, error } = await supabase
    .from('organizaciones')
    .select('id, slug')
    .like('slug', `${PREFIJO}%`);
  if (error) throw new Error(`No se pudo leer organizaciones: ${error.message}`);

  let archivos = 0;
  for (const org of orgs ?? []) {
    if (!String(org.slug).startsWith(PREFIJO)) continue;
    archivos += await borrarCarpeta(supabase, org.id);
    const borrado = await supabase.from('organizaciones').delete().eq('id', org.id);
    if (borrado.error) {
      throw new Error(`No se pudo borrar la organización de prueba: ${borrado.error.message}`);
    }
  }

  // Primero se juntan (borrar mientras se pagina correría las páginas).
  const admin = supabase.auth.admin;
  const dePrueba: string[] = [];
  for (let pagina = 1; pagina <= 50; pagina++) {
    const { data, error: e } = await admin.listUsers({ page: pagina, perPage: 200 });
    if (e) throw new Error(`No se pudo listar usuarios: ${e.message}`);
    for (const u of data.users) if (esCorreoDePrueba(u.email)) dePrueba.push(u.id);
    if (data.users.length < 200) break;
  }
  for (const id of dePrueba) {
    const r = await admin.deleteUser(id);
    if (r.error) throw new Error(`No se pudo borrar la cuenta de prueba: ${r.error.message}`);
  }
  return { organizaciones: orgs?.length ?? 0, usuarios: dePrueba.length, archivos };
}
