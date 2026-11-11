import { FileText, Plus } from 'lucide-react';
import Link from 'next/link';
import {
  Alerta,
  BannerAmbiente,
  clasesBoton,
  EstadoDTE,
  LayoutApp,
  MedidorFolios,
  Monto,
  Paginacion,
  PanelDetalle,
  TipoDTE,
} from '@/components/timbre';
import { DemoTablaDTE } from '../Demos';
import estilos from './app.module.css';

// Pantalla de ejemplo de LayoutApp, con la composición de «Documentos emitidos».
export default function DemoLayoutApp() {
  return (
    <LayoutApp
      org="demo"
      activo="documentos"
      empresa={{ razonSocial: 'Servicios Andinos SpA', rut: '771045626' }}
      usuario={{ nombre: 'Camila Rojas', rol: 'Administradora' }}
      aviso={<BannerAmbiente ambiente="certificacion" />}
    >
      <div className={estilos.cabecera}>
        <div className={estilos.titulos}>
          <p className={estilos.nota}>128 documentos en el período</p>
          <h1 className={estilos.titulo}>Documentos emitidos</h1>
        </div>
        <Link href="/_ds/app" className={clasesBoton('primario')}>
          <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
          Emitir boleta
        </Link>
      </div>
      <div className={estilos.cuerpo}>
        <div className={estilos.lista}>
          <DemoTablaDTE />
          <Paginacion
            pagina={1}
            porPagina={8}
            total={128}
            hrefPagina={(n) => `/_ds/app?pagina=${n}`}
          />
        </div>
        <PanelDetalle aria-labelledby="t-detalle" className={estilos.detalle}>
          <TipoDTE codigo={39} />
          <h2 id="t-detalle" className={estilos.subtitulo}>
            N° 6.811
          </h2>
          <EstadoDTE estado="rechazado" detalle="Track ID 0219366893" />
          <Alerta tono="error" titulo="El SII rechazó el documento">
            El RUT del emisor no coincide con el del CAF. Corrígelo y vuelve a emitir.
          </Alerta>
          <div className={estilos.pozo}>
            <span className={estilos.nota}>Neto</span>
            <Monto valor={10000} tenue />
            <span className={estilos.nota}>IVA (19%)</span>
            <Monto valor={1900} tenue />
            <span className={estilos.total}>Total</span>
            <Monto valor={11900} destacado />
          </div>
          <Link href="/_ds/app" className={clasesBoton('secundario', 'sm')}>
            <FileText size={16} strokeWidth={1.5} aria-hidden="true" />
            Descargar PDF
          </Link>
        </PanelDetalle>
      </div>
      <section aria-labelledby="t-folios" className={estilos.folios}>
        <h2 id="t-folios" className={estilos.subtitulo}>
          Folios de certificación
        </h2>
        <div className={estilos.medidores}>
          <MedidorFolios codigo={39} desde={1} hasta={50} siguiente={12} />
          <MedidorFolios codigo={41} desde={1} hasta={10} siguiente={10} />
        </div>
      </section>
    </LayoutApp>
  );
}
