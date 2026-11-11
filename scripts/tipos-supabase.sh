#!/usr/bin/env sh
# Genera los tipos TypeScript del esquema de Supabase (PLAN-SAAS §4.4).
#
#   pnpm db:tipos            desde la base local (supabase start)
#   pnpm db:tipos --linked   desde el proyecto enlazado (supabase link)
#
# El CI regenera desde una base local con las migraciones y falla si el archivo
# versionado quedó desfasado.
set -eu

DESTINO="apps/web/src/server/supabase/tipos.ts"
ORIGEN="${1:---local}"

pnpm exec supabase gen types typescript "$ORIGEN" --schema public > "$DESTINO.tmp"
mv "$DESTINO.tmp" "$DESTINO"
echo "Tipos generados en $DESTINO"
