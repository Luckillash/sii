'use client';

// Demos interactivas del catálogo /_ds (estado de cliente).

import { useState } from 'react';
import {
  Boton,
  Campo,
  CampoRut,
  Dialogo,
  type DocumentoFila,
  Input,
  Select,
  TablaDTE,
} from '@/components/boleteame';
import { validarRut } from '@/lib/formatos';
import estilos from './ds.module.css';

export const DOCUMENTOS_DEMO: DocumentoFila[] = [
  {
    id: 'a',
    tipo: 33,
    folio: 18244,
    receptor: 'Ferretería Los Aromos SpA',
    rut: '771204562',
    fecha: '10-11-2026',
    total: 1190000,
    estado: 'enviado',
  },
  {
    id: 'b',
    tipo: 33,
    folio: 18243,
    receptor: 'Distribuidora Pacífico Sur Ltda.',
    rut: '96874030K',
    fecha: '10-11-2026',
    total: 4522000,
    estado: 'aceptado',
  },
  {
    id: 'c',
    tipo: 61,
    folio: 490,
    receptor: 'Comercial Andes Verde SpA',
    rut: '768912343',
    fecha: '09-11-2026',
    total: -238000,
    estado: 'reparos',
  },
  {
    id: 'd',
    tipo: 52,
    folio: 1300,
    receptor: 'Panadería La Espiga Ltda.',
    rut: '784521907',
    fecha: '09-11-2026',
    total: 357000,
    estado: 'rechazado',
  },
  {
    id: 'e',
    tipo: 33,
    folio: 18242,
    receptor: 'Ferretería Los Aromos SpA',
    rut: '771204562',
    fecha: '08-11-2026',
    total: 238000,
    estado: 'anulado',
  },
  {
    id: 'f',
    tipo: 39,
    folio: 6811,
    receptor: 'Cliente General',
    rut: '666666666',
    fecha: '08-11-2026',
    total: 11900,
    estado: 'incierto',
  },
];

export function DemoCampoRut() {
  const [rut, setRut] = useState('76.354.771-3');
  return (
    <div className={estilos.pila}>
      <CampoRut
        etiqueta="RUT de la empresa"
        defaultValue="76.354.771-K"
        ayuda="El mismo RUT que figura en tu certificado digital."
      />
      <CampoRut
        etiqueta="RUT del receptor"
        value={rut}
        onChange={(v) => setRut(v)}
        error={validarRut(rut) ? undefined : 'El dígito verificador no corresponde a este RUT.'}
      />
    </div>
  );
}

export function DemoTablaDTE() {
  const [sel, setSel] = useState<string | null>('b');
  return (
    <div className={estilos.pila}>
      <TablaDTE documentos={DOCUMENTOS_DEMO} seleccionado={sel} onSeleccionar={setSel} />
      <TablaDTE documentos={[]} titulo="Sin documentos" />
    </div>
  );
}

export function DemoCampos() {
  return (
    <div className={estilos.fila}>
      <Campo etiqueta="Correo electrónico" ayuda="Usa el correo con el que creaste tu cuenta.">
        <Input type="email" autoComplete="email" placeholder="nombre@empresa.cl" />
      </Campo>
      <Campo etiqueta="Folio" error="El folio está fuera del rango del CAF.">
        <Input mono defaultValue="19001" />
      </Campo>
      <Campo etiqueta="Tipo de documento">
        <Select defaultValue="39">
          <option value="39">39 · Boleta electrónica</option>
          <option value="41">41 · Boleta exenta electrónica</option>
        </Select>
      </Campo>
      <Campo etiqueta="Razón social">
        <Input disabled defaultValue="Servicios Andinos SpA" />
      </Campo>
    </div>
  );
}

export function DemoDialogo() {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  return (
    <>
      <Boton variante="primario" onClick={() => setAbierto(true)}>
        Solicitar folios
      </Boton>
      <Dialogo
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        onConfirmar={() => {
          setCargando(true);
          setTimeout(() => {
            setCargando(false);
            setAbierto(false);
          }, 1200);
        }}
        cargando={cargando}
        titulo="Solicitar 50 folios de boleta electrónica"
        textoConfirmar="Solicitar al SII"
        variante="peligro"
      >
        <p>
          Se pedirán al SII 50 folios de tipo 39 en el ambiente de <strong>certificación</strong>,
          con el certificado de Camila Rojas (12.865.430-5).
        </p>
        <p>Esta operación queda registrada en el SII y no se puede deshacer.</p>
      </Dialogo>
    </>
  );
}
