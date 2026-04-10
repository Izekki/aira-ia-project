/**
 * PermissionPrompt – MCP tool permission dialog.
 *
 * Displayed when the Aira server emits a MCP_PERMISSION_REQUEST event.
 * The user can:
 *   - Allow once   → execute this call only
 *   - Allow always → execute and persist a rule (scoped to tool + scope)
 *   - Deny         → cancel the tool call
 *
 * Props:
 *   request  – { requestId, toolName, params, riskLevel, message }
 *   onDecide – (requestId, decision) callback
 */

import { useEffect, useRef } from 'react';

const RISK_COLORS = {
  LOW: '#4caf50',
  MEDIUM: '#ff9800',
  HIGH: '#f44336',
};

const RISK_ICONS = {
  LOW: '🟢',
  MEDIUM: '🟡',
  HIGH: '🔴',
};

export default function PermissionPrompt({ request, onDecide }) {
  const denyRef = useRef(null);

  useEffect(() => {
    // Focus the deny button by default for safety.
    if (denyRef.current) denyRef.current.focus();
  }, [request?.requestId]);

  if (!request) return null;

  const { requestId, toolName, riskLevel = 'MEDIUM', message, params } = request;
  const color = RISK_COLORS[riskLevel] || RISK_COLORS.MEDIUM;
  const icon = RISK_ICONS[riskLevel] || '🟡';

  function handleDecide(decision) {
    if (typeof onDecide === 'function') {
      onDecide(requestId, decision);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Solicitud de permiso MCP"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: '#1e1e2e',
          border: `2px solid ${color}`,
          borderRadius: 12,
          padding: '28px 32px',
          maxWidth: 480,
          width: '90%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          fontFamily: 'monospace',
          color: '#cdd6f4',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 22 }}>{icon}</span>
          <span style={{ fontWeight: 700, fontSize: 16, color }}>
            Permiso requerido — {riskLevel}
          </span>
        </div>

        {/* Tool name */}
        <div style={{ marginBottom: 8 }}>
          <span style={{ color: '#89b4fa', fontWeight: 600 }}>Herramienta:</span>{' '}
          <code style={{ color: '#a6e3a1' }}>{toolName}</code>
        </div>

        {/* Human-readable description */}
        <div
          style={{
            background: '#181825',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 16,
            fontSize: 13,
            wordBreak: 'break-word',
          }}
        >
          {message}
        </div>

        {/* Params preview */}
        {params && Object.keys(params).length > 0 && (
          <details style={{ marginBottom: 16 }}>
            <summary style={{ cursor: 'pointer', color: '#6c7086', fontSize: 12 }}>
              Ver parámetros
            </summary>
            <pre
              style={{
                background: '#181825',
                borderRadius: 6,
                padding: 10,
                fontSize: 11,
                overflowX: 'auto',
                marginTop: 6,
                color: '#cdd6f4',
              }}
            >
              {JSON.stringify(params, null, 2)}
            </pre>
          </details>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => handleDecide('allow_once')}
            style={btnStyle('#4caf50')}
          >
            ✅ Permitir una vez
          </button>

          <button
            onClick={() => handleDecide('allow_always')}
            style={btnStyle('#2196f3')}
          >
            📌 Permitir siempre
          </button>

          <button
            ref={denyRef}
            onClick={() => handleDecide('deny')}
            style={btnStyle('#f44336')}
          >
            🚫 Denegar
          </button>
        </div>

        {riskLevel === 'HIGH' && (
          <p style={{ fontSize: 11, color: '#f38ba8', marginTop: 12, marginBottom: 0 }}>
            ⚠️ Acción de alto riesgo. Verifica que entiendes qué se ejecutará antes de permitir.
          </p>
        )}
      </div>
    </div>
  );
}

function btnStyle(bg) {
  return {
    background: bg,
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '8px 16px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 13,
    fontFamily: 'monospace',
  };
}
