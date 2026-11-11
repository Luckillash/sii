// `pnpm paridad:generar`: levanta el servidor de captura y corre generar.php.
//
//   node paridad/http/generar.mjs [caso ...]
//
// Los argumentos pasan tal cual a generar.php (filtro de casos). El PHP recibe:
//   - las URLs de los orígenes en PARIDAD_CAPTURA_HTTP, PARIDAD_CAPTURA_HTTPS y
//     PARIDAD_CAPTURA_HTTPS2 (las lee paridad/php/http.php);
//   - la CA de prueba en `curl.cainfo` (cURL) y `openssl.cafile`
//     (file_get_contents), como `-d` en la línea de comandos: son ini de sistema y
//     no se pueden cambiar con ini_set(). La verificación TLS del core queda
//     encendida, contra el certificado de prueba de `localhost`;
//   - `user_agent` vacío (el valor por defecto de PHP): file_get_contents no manda
//     User-Agent aunque el php.ini de la máquina defina uno, así los esperados no
//     dependen de cada instalación.
// El binario de PHP es `php` del PATH, o el de la variable PHP.
//
// Termina con el código de salida de generar.php (2 si no se pudo ejecutar PHP).
// Solo módulos de Node: el job paridad-php del CI lo corre sin `pnpm install`.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarServidorCaptura } from './servidor-captura.mjs';

const generarPhp = join(dirname(fileURLToPath(import.meta.url)), '..', 'php', 'generar.php');

const servidor = await iniciarServidorCaptura();

const codigo = await new Promise((resolve) => {
  // spawn y no spawnSync: el servidor vive en este proceso y tiene que atender al PHP.
  const php = spawn(
    process.env.PHP || 'php',
    [
      '-d',
      `curl.cainfo=${servidor.rutaCa}`,
      '-d',
      `openssl.cafile=${servidor.rutaCa}`,
      '-d',
      'user_agent=',
      generarPhp,
      ...process.argv.slice(2),
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        PARIDAD_CAPTURA_HTTP: servidor.origenes.http,
        PARIDAD_CAPTURA_HTTPS: servidor.origenes.https,
        PARIDAD_CAPTURA_HTTPS2: servidor.origenes.https2,
      },
    },
  );
  php.on('error', (error) => {
    console.error(`No se pudo ejecutar PHP (${error.message}). Ponlo en el PATH o define PHP.`);
    resolve(2);
  });
  php.on('exit', (code, signal) => {
    if (signal !== null) console.error(`generar.php terminó por la señal ${signal}.`);
    resolve(code ?? 1);
  });
});

await servidor.cerrar();
process.exit(codigo);
