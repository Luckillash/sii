import Link from 'next/link';
import { Boton, Campo, clasesBoton, Input, LayoutIngreso } from '@/components/boleteame';
import { metadataDs, soloDesarrollo } from '../solo-desarrollo';
import estilos from './ingreso.module.css';

// Pantalla de ejemplo de LayoutIngreso (plantilla «Ingreso»). Sin lógica de Auth (Fase 2).
export const metadata = metadataDs;

export default function DemoLayoutIngreso() {
  soloDesarrollo();
  return (
    <LayoutIngreso>
      <div className={estilos.titulos}>
        <h1 className={estilos.titulo}>Ingresar</h1>
        <p className={estilos.nota}>Usa el correo con el que creaste tu cuenta.</p>
      </div>
      <form className={estilos.formulario}>
        <Campo etiqueta="Correo electrónico" anchoCompleto>
          <Input type="email" autoComplete="email" placeholder="nombre@empresa.cl" />
        </Campo>
        <Campo
          etiqueta="Contraseña"
          anchoCompleto
          accesorio={<Link href="/_ds/ingreso">¿Olvidaste tu contraseña?</Link>}
        >
          <Input type="password" autoComplete="current-password" />
        </Campo>
        <Boton type="submit" variante="primario" className={estilos.botonGrande}>
          Ingresar
        </Boton>
      </form>
      <Link href="/_ds/ingreso" className={clasesBoton('secundario', 'md', estilos.botonGrande)}>
        Crear cuenta
      </Link>
      <p className={estilos.nota}>
        Para emitir necesitarás tu certificado digital (.pfx) y el RUT de la empresa. Puedes
        cargarlos después de ingresar.
      </p>
    </LayoutIngreso>
  );
}
