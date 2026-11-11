#!/usr/bin/env sh
# Genera los tipos TypeScript del esquema de Supabase (PLAN-SAAS §4.4) desde el
# proyecto en la nube (la única base, producción). Requiere `supabase login` y
# `supabase link` una vez. Alternativa sin CLI: MCP `generate_typescript_types`.
#
#   pnpm db:tipos
#
# Regenerar y versionar el resultado después de cada migración nueva.
set -eu

DESTINO="apps/web/src/server/supabase/tipos.ts"

# --remote con el ref explícito: la CLI 3.x apunta a una base local por defecto.
pnpm exec supabase gen types --lang=typescript --remote=rbrntkztzijaxsnpgpqn --schema public \
  > "$DESTINO.tmp"
mv "$DESTINO.tmp" "$DESTINO"
echo "Tipos generados en $DESTINO"
