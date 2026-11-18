// Lectura del `token` que Flow envía por POST (`application/x-www-form-urlencoded`) a la
// URL de retorno del registro de tarjeta y al callback de los planes. Algunos retornos
// llegan por GET con el token en la query: se aceptan ambos. Solo el token: Flow no manda
// nada más y el resultado se consulta firmado.

const TOKEN_VALIDO = /^[A-Za-z0-9._-]{1,200}$/;

export async function leerTokenFlow(request: Request): Promise<string | null> {
  let token: unknown = new URL(request.url).searchParams.get('token');
  if (!token && request.method === 'POST') {
    try {
      const formulario = await request.formData();
      token = formulario.get('token');
    } catch {
      token = null;
    }
  }
  return typeof token === 'string' && TOKEN_VALIDO.test(token) ? token : null;
}
