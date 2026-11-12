import Link from 'next/link';
import { clasesBoton, LayoutIngreso } from '@/components/timbre';
import estilos from './no-encontrada.module.css';

// 404 de /[org]/*: la organización no existe o el usuario no es miembro. El mismo
// mensaje en ambos casos, para no revelar qué organizaciones existen.
//
// Lo dispara `exigirMembresia()` en cada página. El layout de /[org] no lanza
// notFound() (un not-found.tsx no atrapa lo que lanza el layout de su mismo segmento):
// si no hay membresía, solo pasa `children` y la página lanza.

export default function OrganizacionNoEncontrada() {
  return (
    <LayoutIngreso
      titular="No encontramos esa página."
      bajada="Revisa la dirección o vuelve a tus organizaciones."
    >
      <div className={estilos.titulos}>
        <h1 className={estilos.titulo}>No encontramos esta organización</h1>
        <p className={estilos.nota}>
          No existe o no eres parte de ella. Si alguien te invitó, abre el enlace de la invitación
          con el correo al que llegó.
        </p>
      </div>
      <Link href="/bienvenida" className={clasesBoton('primario', 'md', estilos.boton)}>
        Ir a mis organizaciones
      </Link>
    </LayoutIngreso>
  );
}
