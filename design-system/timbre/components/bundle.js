/* @ds-bundle: {"format":4,"namespace":"Timbre","components":[{"name":"Boton"},{"name":"EstadoDTE"},{"name":"TipoDTE"},{"name":"Monto"},{"name":"CampoRut"},{"name":"Alerta"},{"name":"MedidorFolios"},{"name":"TablaDTE"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  }
  function omit(obj, keys) {
    var r = {};
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && keys.indexOf(k) < 0) r[k] = obj[k];
    return r;
  }

  /* ---------- Glifos (16x16, trazo en currentColor) ---------- */
  var GLIFOS = {
    borrador: [['circle', { cx: 8, cy: 8, r: 5.5, strokeDasharray: '2.2 2' }]],
    firmado: [['circle', { cx: 8, cy: 8, r: 5.5 }], ['circle', { cx: 8, cy: 8, r: 2, fill: 'currentColor', stroke: 'none' }]],
    enviado: [['circle', { cx: 8, cy: 8, r: 5.5 }], ['path', { d: 'M8 5v3.2l2 1.3' }]],
    aceptado: [['circle', { cx: 8, cy: 8, r: 5.5 }], ['path', { d: 'M5.6 8.2l1.7 1.7 3.2-3.4' }]],
    reparos: [['circle', { cx: 8, cy: 8, r: 5.5 }], ['path', { d: 'M8 5v3.6' }], ['circle', { cx: 8, cy: 10.8, r: 0.6, fill: 'currentColor' }]],
    rechazado: [['circle', { cx: 8, cy: 8, r: 5.5 }], ['path', { d: 'M6 6l4 4M10 6l-4 4' }]],
    anulado: [['circle', { cx: 8, cy: 8, r: 5.5 }], ['path', { d: 'M4.2 11.8l7.6-7.6' }]],
    info: [['circle', { cx: 8, cy: 8, r: 5.5 }], ['path', { d: 'M8 7.2v3.8' }], ['circle', { cx: 8, cy: 5.2, r: 0.6, fill: 'currentColor' }]]
  };
  function Glifo(props) {
    var partes = GLIFOS[props.nombre] || GLIFOS.info;
    var hijos = partes.map(function (p, i) { return h(p[0], Object.assign({ key: i }, p[1])); });
    return h('svg', {
      className: cx('tb-glifo', props.className), viewBox: '0 0 16 16', width: props.size || 14, height: props.size || 14,
      fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false'
    }, hijos);
  }

  /* ---------- Boton ---------- */
  function Boton(props) {
    var variante = props.variante || 'secundario';
    var tamano = props.tamano || 'md';
    var rest = omit(props, ['variante', 'tamano', 'className', 'children', 'icono']);
    return h('button', Object.assign({ type: 'button' }, rest, {
      className: cx('tb-btn', 'tb-btn-' + variante, 'tb-btn-' + tamano, props.className)
    }), props.icono ? h('span', { className: 'tb-btn-icono', 'aria-hidden': 'true' }, props.icono) : null, props.children);
  }

  /* ---------- EstadoDTE ---------- */
  var ESTADOS = {
    borrador: { texto: 'Borrador', tono: 'neutro' },
    firmado: { texto: 'Firmado', tono: 'sello' },
    enviado: { texto: 'Enviado', tono: 'info' },
    aceptado: { texto: 'Aceptado', tono: 'exito' },
    reparos: { texto: 'Aceptado con reparos', tono: 'aviso' },
    rechazado: { texto: 'Rechazado', tono: 'error' },
    anulado: { texto: 'Anulado', tono: 'neutro' }
  };
  function EstadoDTE(props) {
    var clave = ESTADOS[props.estado] ? props.estado : 'borrador';
    var e = ESTADOS[clave];
    return h('span', {
      className: cx('tb-estado', 'tb-tono-' + e.tono, clave === 'anulado' && 'tb-estado-anulado', props.className),
      title: props.detalle || undefined
    }, h(Glifo, { nombre: clave, size: 14 }), h('span', null, e.texto));
  }

  /* ---------- TipoDTE ---------- */
  var TIPOS = {
    33: ['Factura electrónica', 'Factura'],
    34: ['Factura no afecta o exenta electrónica', 'Factura exenta'],
    39: ['Boleta electrónica', 'Boleta'],
    41: ['Boleta exenta electrónica', 'Boleta exenta'],
    43: ['Liquidación factura electrónica', 'Liquidación'],
    46: ['Factura de compra electrónica', 'Factura de compra'],
    52: ['Guía de despacho electrónica', 'Guía de despacho'],
    56: ['Nota de débito electrónica', 'Nota de débito'],
    61: ['Nota de crédito electrónica', 'Nota de crédito'],
    110: ['Factura de exportación electrónica', 'Factura exportación'],
    111: ['Nota de débito de exportación electrónica', 'N. débito exportación'],
    112: ['Nota de crédito de exportación electrónica', 'N. crédito exportación']
  };
  function TipoDTE(props) {
    var t = TIPOS[props.codigo] || ['Documento tributario', 'Documento'];
    var nombre = props.corto ? t[1] : t[0];
    return h('span', { className: cx('tb-tipo', props.className), title: t[0] },
      h('span', { className: 'tb-tipo-codigo' }, String(props.codigo)),
      props.soloCodigo ? h('span', { className: 'tb-sr' }, t[0]) : h('span', { className: 'tb-tipo-nombre' }, nombre));
  }

  /* ---------- Monto ---------- */
  function miles(n) {
    var s = String(n);
    var out = '';
    while (s.length > 3) { out = '.' + s.slice(-3) + out; s = s.slice(0, -3); }
    return s + out;
  }
  function formatearMonto(valor, moneda) {
    var v = Number(valor) || 0;
    var neg = v < 0;
    v = Math.abs(v);
    var txt;
    if (!moneda || moneda === 'CLP') {
      txt = '$ ' + miles(Math.round(v));
    } else {
      var ent = Math.floor(v);
      var dec = Math.round((v - ent) * 100);
      if (dec === 100) { ent += 1; dec = 0; }
      var pref = moneda === 'USD' ? 'US$ ' : moneda === 'UF' ? 'UF ' : moneda + ' ';
      txt = pref + miles(ent) + ',' + (dec < 10 ? '0' : '') + dec;
    }
    return (neg ? '−' : '') + txt;
  }
  function Monto(props) {
    return h('span', {
      className: cx('tb-monto', props.destacado && 'tb-monto-destacado', props.tenue && 'tb-monto-tenue', props.className)
    }, formatearMonto(props.valor, props.moneda));
  }

  /* ---------- CampoRut ---------- */
  function limpiarRut(v) { return String(v || '').replace(/[^0-9kK]/g, '').toUpperCase(); }
  function calcularDv(cuerpo) {
    var suma = 0, mul = 2;
    for (var i = cuerpo.length - 1; i >= 0; i--) {
      suma += parseInt(cuerpo.charAt(i), 10) * mul;
      mul = mul === 7 ? 2 : mul + 1;
    }
    var r = 11 - (suma % 11);
    return r === 11 ? '0' : r === 10 ? 'K' : String(r);
  }
  function formatearRut(v) {
    var c = limpiarRut(v);
    if (c.length < 2) return c;
    return miles(c.slice(0, -1).replace(/^0+/, '') || '0') + '-' + c.slice(-1);
  }
  function validarRut(v) {
    var c = limpiarRut(v);
    if (c.length < 2) return false;
    var cuerpo = c.slice(0, -1);
    if (/K/.test(cuerpo)) return false;
    return calcularDv(cuerpo) === c.slice(-1);
  }
  var contadorId = 0;
  function CampoRut(props) {
    var controlado = props.value !== undefined;
    var st = React.useState(props.defaultValue || '');
    var interno = st[0], setInterno = st[1];
    var tocado = React.useState(false);
    var idRef = React.useRef(props.id || 'tb-rut-' + (++contadorId));
    var valor = controlado ? props.value : interno;
    var lleno = limpiarRut(valor).length >= 2;
    var invalido = tocado[0] && lleno && !validarRut(valor);
    var error = props.error || (invalido ? 'El dígito verificador no corresponde a este RUT.' : null);
    var idAyuda = idRef.current + '-ayuda';

    function cambiar(e) {
      var v = e.target.value.replace(/[^0-9kK.\-]/g, '');
      if (!controlado) setInterno(v);
      if (props.onChange) props.onChange(v, validarRut(v));
    }
    function salir() {
      tocado[1](true);
      var f = formatearRut(valor);
      if (!controlado) setInterno(f);
      if (props.onChange && f !== valor) props.onChange(f, validarRut(f));
    }
    return h('div', { className: cx('tb-campo', error && 'tb-campo-error', props.className) },
      h('label', { className: 'tb-campo-etiqueta', htmlFor: idRef.current }, props.etiqueta || 'RUT'),
      h('input', {
        id: idRef.current, className: 'tb-input tb-input-mono', type: 'text', inputMode: 'text', autoComplete: 'off',
        spellCheck: false, maxLength: 12, placeholder: props.placeholder || '12.345.678-5', value: valor,
        disabled: props.disabled, onChange: cambiar, onBlur: salir,
        'aria-invalid': error ? 'true' : undefined, 'aria-describedby': (error || props.ayuda) ? idAyuda : undefined
      }),
      error
        ? h('p', { className: 'tb-campo-ayuda tb-campo-ayuda-error', id: idAyuda }, h(Glifo, { nombre: 'rechazado', size: 14 }), error)
        : props.ayuda ? h('p', { className: 'tb-campo-ayuda', id: idAyuda }, props.ayuda) : null);
  }
  CampoRut.formatear = formatearRut;
  CampoRut.validar = validarRut;

  /* ---------- Alerta ---------- */
  var GLIFO_TONO = { info: 'info', exito: 'aceptado', aviso: 'reparos', error: 'rechazado' };
  function Alerta(props) {
    var tono = GLIFO_TONO[props.tono] ? props.tono : 'info';
    return h('div', { className: cx('tb-alerta', 'tb-tono-' + tono, props.className), role: tono === 'error' ? 'alert' : 'status' },
      h(Glifo, { nombre: GLIFO_TONO[tono], size: 18, className: 'tb-alerta-glifo' }),
      h('div', { className: 'tb-alerta-cuerpo' },
        props.titulo ? h('p', { className: 'tb-alerta-titulo' }, props.titulo) : null,
        props.children ? h('div', { className: 'tb-alerta-texto' }, props.children) : null),
      props.accion ? h('div', { className: 'tb-alerta-accion' }, props.accion) : null);
  }

  /* ---------- MedidorFolios ---------- */
  function MedidorFolios(props) {
    var desde = Number(props.desde), hasta = Number(props.hasta), siguiente = Number(props.siguiente);
    var total = Math.max(0, hasta - desde + 1);
    var usados = Math.min(total, Math.max(0, siguiente - desde));
    var quedan = total - usados;
    var umbral = props.umbralAviso == null ? 0.15 : props.umbralAviso;
    var estado = quedan === 0 ? 'error' : (total && quedan / total <= umbral) ? 'aviso' : 'sello';
    var pct = total ? Math.round((usados / total) * 1000) / 10 : 0;
    var nota = estado === 'error' ? 'CAF agotado: solicita un nuevo rango de folios al SII antes de emitir.'
      : estado === 'aviso' ? 'Quedan pocos folios: solicita un nuevo CAF.'
      : 'Rango vigente ' + miles(desde) + ' – ' + miles(hasta) + '.';
    return h('div', { className: cx('tb-folios', 'tb-folios-' + estado, props.className) },
      h('div', { className: 'tb-folios-cabecera' },
        props.codigo != null ? h(TipoDTE, { codigo: props.codigo, corto: true }) : h('span', null, 'Folios'),
        h('span', { className: 'tb-folios-cifra' }, h('strong', null, miles(quedan)), ' de ', miles(total), ' disponibles')),
      h('div', {
        className: 'tb-folios-barra', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': usados,
        'aria-label': 'Folios usados: ' + usados + ' de ' + total
      }, h('div', { className: 'tb-folios-uso', style: { width: pct + '%' } })),
      h('p', { className: 'tb-folios-nota' }, estado !== 'sello' ? h(Glifo, { nombre: estado === 'error' ? 'rechazado' : 'reparos', size: 14 }) : null, nota));
  }

  /* ---------- TablaDTE ---------- */
  function TablaDTE(props) {
    var docs = props.documentos || [];
    var sel = props.seleccionado;
    var encabezados = ['Tipo', 'Folio', 'Receptor', 'Emisión', 'Total', 'Estado'];
    return h('div', { className: cx('tb-tabla-marco', props.className) },
      h('table', { className: 'tb-tabla' },
        props.titulo ? h('caption', null, props.titulo) : null,
        h('thead', null, h('tr', null, encabezados.map(function (t, i) {
          return h('th', { key: t, scope: 'col', className: i === 4 ? 'tb-num' : undefined }, t);
        }))),
        h('tbody', null, docs.length === 0
          ? h('tr', null, h('td', { colSpan: 6, className: 'tb-tabla-vacia' }, props.vacio || 'Aún no hay documentos emitidos en este período.'))
          : docs.map(function (d) {
            var activo = sel != null && sel === d.id;
            return h('tr', {
              key: d.id, className: cx(activo && 'tb-fila-activa', props.onSeleccionar && 'tb-fila-clic'), 'aria-selected': props.onSeleccionar ? String(activo) : undefined,
              tabIndex: props.onSeleccionar ? 0 : undefined,
              onClick: props.onSeleccionar ? function () { props.onSeleccionar(d.id); } : undefined,
              onKeyDown: props.onSeleccionar ? function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onSeleccionar(d.id); } } : undefined
            },
              h('td', null, h(TipoDTE, { codigo: d.tipo, corto: true })),
              h('td', { className: 'tb-mono' }, miles(d.folio)),
              h('td', null, h('div', { className: 'tb-receptor' }, d.receptor), h('div', { className: 'tb-rut' }, formatearRut(d.rut))),
              h('td', { className: 'tb-fecha' }, d.fecha),
              h('td', { className: 'tb-num' }, h(Monto, { valor: d.total, moneda: d.moneda })),
              h('td', null, h(EstadoDTE, { estado: d.estado })));
          }))));
  }

  var Timbre = {
    Boton: Boton, EstadoDTE: EstadoDTE, TipoDTE: TipoDTE, Monto: Monto, CampoRut: CampoRut,
    Alerta: Alerta, MedidorFolios: MedidorFolios, TablaDTE: TablaDTE,
    utils: { formatearMonto: formatearMonto, formatearRut: formatearRut, validarRut: validarRut, calcularDv: calcularDv, TIPOS_DTE: TIPOS }
  };
  window.Timbre = Object.assign(window.Timbre || {}, Timbre);
})();
