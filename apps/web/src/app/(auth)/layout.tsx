import type { ReactNode } from 'react';
import { LayoutIngreso } from '@/components/boleteame';

// Pantallas de acceso (PLAN-SAAS Fase 2): ingresar, crear cuenta, recuperar y
// restablecer contraseña, con la plantilla «Ingreso».
export default function LayoutAuth({ children }: { children: ReactNode }) {
  return <LayoutIngreso>{children}</LayoutIngreso>;
}
