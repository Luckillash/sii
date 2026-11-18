import { describe, expect, it } from 'vitest';
import { leerTokenFlow } from './token';

const URL_RUTA = 'https://app.boleteame.dev/api/pagos/flow/registro';

function post(cuerpo: string, tipo = 'application/x-www-form-urlencoded', url = URL_RUTA) {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': tipo }, body: cuerpo });
}

describe('leerTokenFlow', () => {
  it('POST form-urlencoded (como lo manda Flow)', async () => {
    expect(await leerTokenFlow(post('token=ABC123.def_ghi-9'))).toBe('ABC123.def_ghi-9');
  });

  it('POST multipart también sirve', async () => {
    const formulario = new FormData();
    formulario.set('token', 'tok-multipart');
    const r = new Request(URL_RUTA, { method: 'POST', body: formulario });
    expect(await leerTokenFlow(r)).toBe('tok-multipart');
  });

  it('GET con el token en la query (y la query gana en un POST)', async () => {
    expect(await leerTokenFlow(new Request(`${URL_RUTA}?token=tok-get`))).toBe('tok-get');
    expect(
      await leerTokenFlow(post('token=del-cuerpo', undefined, `${URL_RUTA}?token=de-query`)),
    ).toBe('de-query');
  });

  it('GET no lee el cuerpo', async () => {
    expect(await leerTokenFlow(new Request(URL_RUTA))).toBeNull();
  });

  it.each([
    ['vacío', 'token='],
    ['con espacios', 'token=a%20b'],
    ['con caracteres raros', 'token=%3Cscript%3E'],
    ['demasiado largo', `token=${'a'.repeat(201)}`],
    ['sin token', 'otro=1'],
  ])('token inválido (%s): null', async (_caso, cuerpo) => {
    expect(await leerTokenFlow(post(cuerpo))).toBeNull();
  });

  it('cuerpo que no es formulario (JSON): null, sin lanzar', async () => {
    expect(await leerTokenFlow(post('{"token":"abc"}', 'application/json'))).toBeNull();
  });

  it('largo máximo de 200: válido', async () => {
    const largo = 'a'.repeat(200);
    expect(await leerTokenFlow(post(`token=${largo}`))).toBe(largo);
  });
});
