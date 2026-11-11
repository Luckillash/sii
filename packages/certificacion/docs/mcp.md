# Servidor MCP `sii-mcp`

Servidor [MCP](https://modelcontextprotocol.io) (stdio) que publica los 15 comandos de la
CLI [`sii`](cli.md) como herramientas, para usarlos desde Claude Code, Claude Desktop u otro
cliente MCP.

Código: `apps/cli/src/mcp/` (`servidor.ts` registra las herramientas, `herramientas.ts`
traduce comandos ↔ herramientas y clasifica el riesgo) y `apps/cli/src/mcp-main.ts`
(entrada). Tests: `apps/cli/test/mcp/`.

## Cómo funciona

- Cada comando `sii <grupo> <comando>` es una herramienta `<grupo>_<comando>` con guiones
  bajos: `certificacion_enviar_set`, `produccion_emitir`, `util_verificar_ted`...
- Las opciones `--x-y` son propiedades `x_y` (`--folio-inicial 5` → `"folio_inicial": "5"`),
  los argumentos posicionales van en `"argumentos"` y `--env` es `"env"`.
- La descripción de cada herramienta incluye la ayuda completa del comando.
- Cada llamada corre exactamente el mismo código que la CLI (`ejecutarCli`), con la misma
  validación, el mismo `.env` y los mismos códigos de salida. El resultado trae la salida,
  los errores y el código (`structuredContent: { codigo, salida, errores }`). Un código
  distinto de 0 se marca con `isError`.
- Las llamadas se ejecutan **de a una**: los comandos escriben archivos de salida, registros
  de folios y la caché de tokens.

## Envíos al SII: deshabilitados por defecto

Las herramientas que mandan al SII operaciones con efecto real se marcan como destructivas
(`destructiveHint`). **Sin `--permitir-envios` el servidor las rechaza** antes de ejecutar
nada (código 2). Igual se pueden usar para validar y armar sin enviar:

| Herramienta | Envía... | Para no enviar |
|---|---|---|
| `certificacion_postular`, `_descargar_set`, `_solicitar_folios`, `_solicitar_revision`, `_declarar` | con `confirmar=true` | omite `confirmar` |
| `produccion_emitir` | con `confirmar=true` | omite `confirmar` |
| `certificacion_enviar_set`, `certificacion_enviar_rcof` | siempre | `solo_armar=true` |

Las consultas (`estado_envio`, `estado_declaracion`, `verificar_portal`, `consultar`) y las
utilidades locales (`firmar_semilla`, `verificar_ted`) son de solo lectura. `seguimiento`
solo consulta, pero agrega líneas a la bitácora local.

Con `--permitir-envios` (o `SII_MCP_PERMITIR_ENVIOS=1`) esas llamadas sí se ejecutan. Cada
comando conserva sus propias protecciones (`--confirmar`, un registro por folio, toda la
validación antes de la primera petición). Habilítalo solo cuando vayas a revisar cada
llamada en el cliente: en producción se emiten documentos tributarios reales.

Al agregar un comando a la CLI hay que clasificarlo en `RIESGOS` (`herramientas.ts`). Un
test falla si falta alguno, y un comando sin clasificar se trata como si siempre enviara.

## Cómo se ejecuta

```
pnpm mcp                                              # desde el código fuente
node --conditions=source apps/cli/src/mcp-main.ts     # lo mismo, sin pnpm
node apps/cli/dist/mcp-main.js                        # compilado (pnpm build)
```

Opciones:

- `--cwd <carpeta>`: carpeta de trabajo, donde se busca el `.env` y contra la que se
  resuelven las rutas relativas. Por defecto, la carpeta actual.
- `--permitir-envios`: ver arriba.

La salida estándar es del protocolo MCP: el aviso de inicio y los errores van a stderr.

### Claude Code

El repo trae un `.mcp.json` que registra el servidor `sii` (desde el código fuente, con la
raíz del repo como carpeta de trabajo y los envíos deshabilitados). Claude Code pide
aprobarlo la primera vez. Para agregarlo a mano:

```
claude mcp add sii -- node --conditions=source apps/cli/src/mcp-main.ts
```

### Otros clientes (Claude Desktop, etc.)

Usa rutas absolutas, porque el cliente no arranca el servidor en el repo:

```json
{
  "mcpServers": {
    "sii": {
      "command": "node",
      "args": [
        "C:/ruta/a/certificacion-node/apps/cli/dist/mcp-main.js",
        "--cwd", "C:/ruta/a/certificacion-node"
      ]
    }
  }
}
```
