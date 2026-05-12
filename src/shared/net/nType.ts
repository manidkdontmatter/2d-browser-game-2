// Enumerates nengi schema identifiers shared by the server and browser client.
export { NetEntityKind } from '../domain/snapshots.js';

export enum NType {
  InputCommand = 1,
  NetEntity = 2,
  IdentityMessage = 3,
  WorldInitMessage = 4,
  TileMutationMessage = 5,
  MapTransferMessage = 6,
}
