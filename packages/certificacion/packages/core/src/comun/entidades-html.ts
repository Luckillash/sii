// `html_entity_decode` de PHP 8.3 y la tabla de entidades con nombre de HTML 4.01.
// Lo usan el canal SOAP (las respuestas de CrSeed / GetTokenFromSeed vienen
// escapadas dentro del sobre) y el parser HTML de los asistentes del SII
// (`html.ts`, que suma `&apos;` como hace libxml). Movido desde
// certificacion/dtews-soap.ts en la fase 5, sin cambios.

/**
 * Entidades con nombre de HTML 4.01 (las de
 * `get_html_translation_table(HTML_ENTITIES, ENT_QUOTES | ENT_HTML401)` de PHP
 * 8.3), como `nombre:código`. `&apos;` no es de HTML 4.01: no se decodifica.
 */
const TABLA_HTML401 =
  'quot:34 amp:38 lt:60 gt:62 nbsp:160 iexcl:161 cent:162 pound:163 curren:164 yen:165 ' +
  'brvbar:166 sect:167 uml:168 copy:169 ordf:170 laquo:171 not:172 shy:173 reg:174 macr:175 ' +
  'deg:176 plusmn:177 sup2:178 sup3:179 acute:180 micro:181 para:182 middot:183 cedil:184 ' +
  'sup1:185 ordm:186 raquo:187 frac14:188 frac12:189 frac34:190 iquest:191 Agrave:192 ' +
  'Aacute:193 Acirc:194 Atilde:195 Auml:196 Aring:197 AElig:198 Ccedil:199 Egrave:200 ' +
  'Eacute:201 Ecirc:202 Euml:203 Igrave:204 Iacute:205 Icirc:206 Iuml:207 ETH:208 Ntilde:209 ' +
  'Ograve:210 Oacute:211 Ocirc:212 Otilde:213 Ouml:214 times:215 Oslash:216 Ugrave:217 ' +
  'Uacute:218 Ucirc:219 Uuml:220 Yacute:221 THORN:222 szlig:223 agrave:224 aacute:225 ' +
  'acirc:226 atilde:227 auml:228 aring:229 aelig:230 ccedil:231 egrave:232 eacute:233 ' +
  'ecirc:234 euml:235 igrave:236 iacute:237 icirc:238 iuml:239 eth:240 ntilde:241 ograve:242 ' +
  'oacute:243 ocirc:244 otilde:245 ouml:246 divide:247 oslash:248 ugrave:249 uacute:250 ' +
  'ucirc:251 uuml:252 yacute:253 thorn:254 yuml:255 OElig:338 oelig:339 Scaron:352 ' +
  'scaron:353 Yuml:376 fnof:402 circ:710 tilde:732 Alpha:913 Beta:914 Gamma:915 Delta:916 ' +
  'Epsilon:917 Zeta:918 Eta:919 Theta:920 Iota:921 Kappa:922 Lambda:923 Mu:924 Nu:925 Xi:926 ' +
  'Omicron:927 Pi:928 Rho:929 Sigma:931 Tau:932 Upsilon:933 Phi:934 Chi:935 Psi:936 ' +
  'Omega:937 alpha:945 beta:946 gamma:947 delta:948 epsilon:949 zeta:950 eta:951 theta:952 ' +
  'iota:953 kappa:954 lambda:955 mu:956 nu:957 xi:958 omicron:959 pi:960 rho:961 sigmaf:962 ' +
  'sigma:963 tau:964 upsilon:965 phi:966 chi:967 psi:968 omega:969 thetasym:977 upsih:978 ' +
  'piv:982 ensp:8194 emsp:8195 thinsp:8201 zwnj:8204 zwj:8205 lrm:8206 rlm:8207 ndash:8211 ' +
  'mdash:8212 lsquo:8216 rsquo:8217 sbquo:8218 ldquo:8220 rdquo:8221 bdquo:8222 dagger:8224 ' +
  'Dagger:8225 bull:8226 hellip:8230 permil:8240 prime:8242 Prime:8243 lsaquo:8249 ' +
  'rsaquo:8250 oline:8254 frasl:8260 euro:8364 image:8465 weierp:8472 real:8476 trade:8482 ' +
  'alefsym:8501 larr:8592 uarr:8593 rarr:8594 darr:8595 harr:8596 crarr:8629 lArr:8656 ' +
  'uArr:8657 rArr:8658 dArr:8659 hArr:8660 forall:8704 part:8706 exist:8707 empty:8709 ' +
  'nabla:8711 isin:8712 notin:8713 ni:8715 prod:8719 sum:8721 minus:8722 lowast:8727 ' +
  'radic:8730 prop:8733 infin:8734 ang:8736 and:8743 or:8744 cap:8745 cup:8746 int:8747 ' +
  'there4:8756 sim:8764 cong:8773 asymp:8776 ne:8800 equiv:8801 le:8804 ge:8805 sub:8834 ' +
  'sup:8835 nsub:8836 sube:8838 supe:8839 oplus:8853 otimes:8855 perp:8869 sdot:8901 ' +
  'lceil:8968 rceil:8969 lfloor:8970 rfloor:8971 lang:9001 rang:9002 loz:9674 spades:9824 ' +
  'clubs:9827 hearts:9829 diams:9830';

export const ENTIDADES_HTML401: ReadonlyMap<string, string> = new Map(
  TABLA_HTML401.split(' ').map((par) => {
    const [nombre = '', codigo = ''] = par.split(':');
    return [nombre, String.fromCodePoint(Number(codigo))] as const;
  }),
);

/**
 * `html_entity_decode($texto)` con las opciones por defecto de PHP 8.3
 * (`ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML401`, UTF-8), verificado contra PHP:
 *
 * - Las 252 entidades con nombre de HTML 4.01, distinguiendo mayúsculas
 *   (`&eacute;` → é, `&AMP;` queda tal cual). `&apos;` no se decodifica.
 * - Numéricas decimales y hexadecimales (con el `0x` extra que acepta `strtol`),
 *   con `;` obligatorio, solo si el carácter está permitido en HTML 4.01: \t, \n,
 *   \r, U+0020–U+007E, U+00A0–U+D7FF y U+E000–U+10FFFF. `&#0;`, `&#127;`,
 *   `&#128;` o `&#xD800;` quedan tal cual.
 * - Una sola pasada: `&amp;lt;` da `&lt;`.
 *
 * Es lo que hace el PHP con las respuestas de CrSeed y GetTokenFromSeed antes de
 * buscar `<SEMILLA>` y `<TOKEN>` (el XML del SII viene escapado dentro del sobre).
 */
export function decodificarEntidadesHtml(texto: string): string {
  return texto.replace(
    /&(?:#([0-9]+)|#[xX](?:0[xX])?([0-9a-fA-F]+)|([A-Za-z0-9]+));/g,
    (entidad, decimal?: string, hexadecimal?: string, nombre?: string) => {
      if (nombre !== undefined) return ENTIDADES_HTML401.get(nombre) ?? entidad;
      const codigo =
        decimal !== undefined
          ? Number.parseInt(decimal, 10)
          : Number.parseInt(hexadecimal ?? '', 16);
      return permitidoHtml401(codigo) ? String.fromCodePoint(codigo) : entidad;
    },
  );
}

function permitidoHtml401(codigo: number): boolean {
  return (
    codigo === 0x09 ||
    codigo === 0x0a ||
    codigo === 0x0d ||
    (codigo >= 0x20 && codigo <= 0x7e) ||
    (codigo >= 0xa0 && codigo <= 0xd7ff) ||
    (codigo >= 0xe000 && codigo <= 0x10ffff)
  );
}
