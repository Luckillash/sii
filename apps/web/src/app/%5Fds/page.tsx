import { Hash, LayoutDashboard, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Alerta,
  BannerAmbiente,
  Boton,
  EstadoDTE,
  type EstadoDte,
  MedidorFolios,
  Monto,
  NavItem,
  Paginacion,
  PanelDetalle,
  Tabla,
  Tarjeta,
  Td,
  Th,
  TipoDTE,
} from '@/components/timbre';
import { DemoCampoRut, DemoCampos, DemoDialogo, DemoTablaDTE } from './Demos';
import estilos from './ds.module.css';
import { SelectorTema } from './SelectorTema';

const ESTADOS: EstadoDte[] = [
  'borrador',
  'firmado',
  'enviado',
  'aceptado',
  'reparos',
  'rechazado',
  'anulado',
  'incierto',
];

function Seccion({
  id,
  titulo,
  nota,
  children,
}: {
  id: string;
  titulo: string;
  nota?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`t-${id}`} className={estilos.seccion} data-componente={id}>
      <header className={estilos.seccionCabecera}>
        <h2 id={`t-${id}`} className={estilos.seccionTitulo}>
          {titulo}
        </h2>
        {nota ? <p className={estilos.nota}>{nota}</p> : null}
      </header>
      <div className={estilos.muestra}>{children}</div>
    </section>
  );
}

function FilaMonto({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className={estilos.filaMonto}>
      <span className={estilos.nota}>{etiqueta}</span>
      {children}
    </div>
  );
}

export default function CatalogoDs() {
  return (
    <main className={estilos.catalogo}>
      <header className={estilos.cabecera}>
        <div>
          <p className={estilos.nota}>Solo desarrollo · Fase 1</p>
          <h1 className={estilos.titulo}>Design system Timbre</h1>
        </div>
        <SelectorTema />
      </header>
      <nav aria-label="Pantallas de ejemplo" className={estilos.fila}>
        <Link href="/_ds/app">LayoutApp</Link>
        <Link href="/_ds/ingreso">LayoutIngreso</Link>
      </nav>

      <Seccion id="Boton" titulo="Boton" nota="primario · secundario · discreto · peligro · sm">
        <div className={estilos.fila}>
          <Boton variante="primario">Emitir boleta</Boton>
          <Boton>Previsualizar PDF</Boton>
          <Boton variante="discreto">Guardar borrador</Boton>
          <Boton variante="peligro">Anular folios</Boton>
        </div>
        <div className={estilos.fila}>
          <Boton tamano="sm">Descargar XML</Boton>
          <Boton tamano="sm" variante="discreto">
            Copiar Track ID
          </Boton>
          <Boton tamano="sm" variante="primario" disabled>
            Enviar al SII
          </Boton>
        </div>
      </Seccion>

      <Seccion id="EstadoDTE" titulo="EstadoDTE" nota="Incluye «Por verificar» (incierto, D3)">
        <div className={estilos.fila}>
          {ESTADOS.map((e) => (
            <EstadoDTE
              key={e}
              estado={e}
              detalle={e === 'enviado' ? 'Track ID 0219384756' : undefined}
            />
          ))}
        </div>
      </Seccion>

      <Seccion id="TipoDTE" titulo="TipoDTE">
        <div className={estilos.fila}>
          <TipoDTE codigo={39} />
          <TipoDTE codigo={41} />
          <TipoDTE codigo={33} />
        </div>
        <div className={estilos.fila}>
          <TipoDTE codigo={39} corto />
          <TipoDTE codigo={34} corto />
          <TipoDTE codigo={56} corto />
          <TipoDTE codigo={110} soloCodigo />
        </div>
      </Seccion>

      <Seccion id="Monto" titulo="Monto">
        <div className={estilos.fila}>
          <div className={estilos.pozo}>
            <FilaMonto etiqueta="Neto">
              <Monto valor={1000000} tenue />
            </FilaMonto>
            <FilaMonto etiqueta="IVA (19%)">
              <Monto valor={190000} tenue />
            </FilaMonto>
            <div className={estilos.pozoTotal}>
              <FilaMonto etiqueta="Total">
                <Monto valor={1190000} destacado />
              </FilaMonto>
            </div>
          </div>
          <div className={estilos.pilaDerecha}>
            <Monto valor={-238000} />
            <Monto valor={12400.5} moneda="USD" />
            <Monto valor={35.2} moneda="UF" />
          </div>
        </div>
      </Seccion>

      <Seccion id="CampoRut" titulo="CampoRut">
        <DemoCampoRut />
      </Seccion>

      <Seccion id="Alerta" titulo="Alerta" nota="info · éxito · aviso · error">
        <div className={estilos.pilaAncha}>
          <Alerta tono="info" titulo="Estás en el ambiente de certificación del SII">
            Los documentos que emitas aquí no tienen validez tributaria.
          </Alerta>
          <Alerta tono="exito" titulo="El SII aceptó el set de pruebas">
            Sigue con la solicitud de revisión del set.
          </Alerta>
          <Alerta
            tono="aviso"
            titulo="Tu certificado digital vence en 12 días"
            accion={<Boton tamano="sm">Cargar certificado</Boton>}
          >
            Sin un certificado vigente no podrás firmar documentos.
          </Alerta>
          <Alerta
            tono="error"
            titulo="El SII rechazó la boleta N° 6.811"
            accion={
              <Boton tamano="sm" variante="discreto">
                Ver detalle
              </Boton>
            }
          >
            El RUT del emisor no coincide con el del CAF. Corrígelo y vuelve a emitir.
          </Alerta>
        </div>
      </Seccion>

      <Seccion id="MedidorFolios" titulo="MedidorFolios">
        <div className={estilos.fila}>
          <MedidorFolios codigo={39} desde={18001} hasta={19000} siguiente={18245} />
          <MedidorFolios codigo={41} desde={401} hasta={500} siguiente={491} />
          <MedidorFolios codigo={39} desde={1201} hasta={1300} siguiente={1301} />
        </div>
      </Seccion>

      <Seccion id="TablaDTE" titulo="TablaDTE">
        <DemoTablaDTE />
      </Seccion>

      <Seccion id="BannerAmbiente" titulo="BannerAmbiente" nota="En producción no se muestra">
        <div className={estilos.pilaAncha}>
          <BannerAmbiente ambiente="certificacion" />
          <BannerAmbiente ambiente="produccion" />
        </div>
      </Seccion>

      <Seccion id="Campo" titulo="Campo, Input y Select">
        <DemoCampos />
      </Seccion>

      <Seccion id="Tarjeta" titulo="Tarjeta y Tabla">
        <div className={estilos.fila}>
          <Tarjeta aria-labelledby="t-cert" className={estilos.tarjetaDemo}>
            <h3 id="t-cert" className={estilos.subtitulo}>
              Certificado digital
            </h3>
            <p className={estilos.nota}>Camila Rojas · vence el 22-11-2026</p>
          </Tarjeta>
          <Tarjeta variante="plana" className={estilos.tarjetaDemo}>
            <p>Tarjeta plana, sin sombra.</p>
          </Tarjeta>
        </div>
        <Tabla titulo="Folios por tipo" etiqueta="Folios por tipo">
          <thead>
            <tr>
              <Th>Tipo</Th>
              <Th num>Disponibles</Th>
              <Th num>Monto emitido</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>
                <TipoDTE codigo={39} corto />
              </Td>
              <Td num mono>
                755
              </Td>
              <Td num>
                <Monto valor={2380000} />
              </Td>
            </tr>
            <tr>
              <Td>
                <TipoDTE codigo={41} corto />
              </Td>
              <Td num mono>
                9
              </Td>
              <Td num>
                <Monto valor={45000} />
              </Td>
            </tr>
          </tbody>
        </Tabla>
      </Seccion>

      <Seccion id="NavItem" titulo="NavItem">
        <nav aria-label="Ejemplo de menú" className={estilos.menuDemo}>
          <NavItem href="#NavItem" icono={LayoutDashboard}>
            Tablero
          </NavItem>
          <NavItem href="#NavItem" icono={Hash} activo>
            Folios (CAF)
          </NavItem>
          <NavItem href="#NavItem" icono={ShieldCheck}>
            Certificación
          </NavItem>
        </nav>
      </Seccion>

      <Seccion id="PanelDetalle" titulo="PanelDetalle y Paginacion">
        <div className={estilos.fila}>
          <PanelDetalle
            aria-labelledby="t-panel"
            hrefCerrar="#PanelDetalle"
            className={estilos.panelDemo}
          >
            <TipoDTE codigo={39} />
            <h3 id="t-panel" className={estilos.subtitulo}>
              N° 6.811
            </h3>
            <EstadoDTE estado="incierto" detalle="Envío sin Track ID" />
            <Alerta tono="aviso" titulo="No sabemos si el SII recibió el envío">
              Revisa el estado en el sitio del SII antes de volver a enviarlo.
            </Alerta>
          </PanelDetalle>
        </div>
        <Paginacion pagina={1} porPagina={8} total={128} hrefPagina={(n) => `/_ds?pagina=${n}`} />
      </Seccion>

      <Seccion id="Dialogo" titulo="Dialogo" nota="Confirmación de operaciones ⚠️">
        <DemoDialogo />
      </Seccion>
    </main>
  );
}
