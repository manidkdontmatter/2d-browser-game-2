// Defines shared Skale collision layers so client prediction and server authority use the same masks.
import { layer } from 'skale-physics';

export const wallLayer = layer(0);
export const bodyLayer = layer(1);
export const projectileLayer = layer(2);
