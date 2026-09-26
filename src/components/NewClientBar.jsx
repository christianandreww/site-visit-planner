import { useState } from 'react';
import AddressSearch from './AddressSearch.jsx';

/**
 * The 30-second flow. While on a call: type the client's name, type their
 * address, tap a suggestion — an orange pin appears immediately.
 */
export default function NewClientBar({
  currentClient,
  onSetClient,
  onClearClient,
  onSaveClient,
}) {
  const [name, setName] = useState('');

  if (currentClient) {
    return (
      <div className="topbar topbar-active">
        <span className="dot" aria-hidden="true" />
        <div className="client-chip">
          <strong>{currentClient.name}</strong>
          <span>{currentClient.address}</span>
        </div>
        <button className="btn btn-primary btn-sm" onClick={onSaveClient}>
          Save visit
        </button>
        <button
          className="btn btn-ghost btn-sm"
          aria-label="Clear new client"
          onClick={() => {
            setName('');
            onClearClient();
          }}
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="topbar">
      <input
        className="input input-name"
        placeholder="New client's name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <AddressSearch
        placeholder="Address or postal code…"
        onPick={(place) => {
          if (place) onSetClient({ name: name.trim() || 'New client', ...place });
        }}
      />
    </div>
  );
}
