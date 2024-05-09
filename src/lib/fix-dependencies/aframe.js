// Labojums problēmai ar konfliktējošām komponentēm "aframe" un "super-hands" bibliotēkās
// Saite: https://github.com/c-frame/aframe-super-hands-component/issues/238
import aframe from 'aframe';
import * as cannon from 'cannon-es';

delete aframe.components['grabbable'];

export const AFRAME = aframe;
export const THREE = AFRAME.THREE;
export const CANNON = window.CANNON || cannon;