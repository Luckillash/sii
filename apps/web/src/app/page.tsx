import styles from './page.module.css';

export default function Inicio() {
  return (
    <main className={styles.principal}>
      <h1 className={styles.titulo}>Boletéame</h1>
      <p className={styles.texto}>
        Emisión de boletas electrónicas y certificación ante el SII. Estamos preparando la
        aplicación.
      </p>
    </main>
  );
}
