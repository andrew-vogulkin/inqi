import { AsyncStatus, DossierOrigin } from '../conventions/enums';
import { assembleDossier, applyProvenance, DossierVM } from '../conventions/dossier';
import { ThreadMessageDto } from '../api/types';
import { Action, ActionType } from './actions';

export type ChainMessage = ThreadMessageDto;

export interface DossierState {
  status: AsyncStatus;
  origin: DossierOrigin;
  dossier: DossierVM | null;
  chain: ChainMessage[] | null; // admin origin only — never set for customers
  /** True while the authoritative provenance overlay (customer) or chain (admin) is in flight — sections show a spinner, not the provisional data. */
  overlayPending: boolean;
  error: string | null;
}

export const initialDossierState: DossierState = {
  status: AsyncStatus.Idle,
  origin: DossierOrigin.Customer,
  dossier: null,
  chain: null,
  overlayPending: false,
  error: null,
};

/** Research dossier slice (FE-08). Assembly is the pure `assembleDossier`; chain only for admin. */
export function dossierReducer(state: DossierState, action: Action): DossierState {
  switch (action.type) {
    case ActionType.DossierLoaded:
      return { ...state, status: AsyncStatus.Ready, origin: action.origin, dossier: assembleDossier({ option: action.option, rank: action.rank }), chain: null, overlayPending: true, error: null };
    case ActionType.DossierLoadFailed:
      return { ...state, status: AsyncStatus.Error, overlayPending: false, error: action.message };
    case ActionType.DossierChainLoaded:
      // Defensive: the chain is admin-only; ignore if somehow dispatched for a customer.
      return state.origin === DossierOrigin.Admin ? { ...state, chain: action.messages, overlayPending: false } : state;
    case ActionType.DossierProvenanceLoaded:
      // HP-20: overlay the authoritative customer-safe provenance onto the VM.
      return state.dossier ? { ...state, dossier: applyProvenance({ vm: state.dossier, provenance: action.provenance }), overlayPending: false } : state;
    case ActionType.DossierProvenanceFailed:
      // Overlay unavailable — fall back to the option-derived sections rather than spin forever.
      return { ...state, overlayPending: false };
    default:
      return state;
  }
}
