export default function WakeActivationOverlay({ onActivate }) {
  return (
    <div className="wake-overlay" role="dialog" aria-modal="true">
      <div className="wake-card">
        <h2>Activar Aira</h2>
        <p>
          Haz clic para habilitar microfono y canal de voz.
        </p>
        <button type="button" onClick={onActivate}>
          Hacer clic para activar a Aira
        </button>
      </div>
    </div>
  );
}
