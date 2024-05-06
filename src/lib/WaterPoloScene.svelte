<script>
  import { onMount } from "svelte";
  
  import AFRAME from "aframe";

  // Visi kameras kustību veidi:
  // import "aframe-extras/controls/index.js";
  import "aframe-extras";
  
  // Saules un debesu objekts:
  import "./components/sun.js";

  // Peldoša objekta komponente:
  import "./animations/floating.js";

  // "Drag-n-drop" komponente
  // Oriģinālais: https://github.com/jesstelford/aframe-click-drag-component
  // Atjaunotā versija, kas darbojas kopā ar A-Frame 1.5.0: https://github.com/kumitterer/aframe-click-drag-component
  // import registerClickDrag from '@kumitterer/aframe-click-drag-component';

  let aframeScene;

  let sun;

  let waterPoloBall;

  onMount(() => {
    // Ja objekts tiek vilkts pa ekrānu, to attiecīgi marķējam ar statusu "dragging":
    waterPoloBall.addEventListener('dragstart', (e) => {
      console.log("dragstart: ", e);
      e.target.addState('dragging');
    });

    waterPoloBall.addEventListener('dragend', (e) => {
      console.log("dragend: ", e);
      e.target.removeState('dragging');
    });
  });

</script>

<!-- Avots renderer atribūtam: https://aframe.io/docs/1.2.0/components/renderer.html#logarithmicdepthbuffer -->
<a-scene 
  bind:this={aframeScene} 
  renderer="logarithmicDepthBuffer: true" 
>
  <!-- Definē brīvi kustināmu kameru: -->
  <a-entity id="rig" movement-controls position="0 1.6 25">
    <a-entity
      camera
      look-controls
      orbit-controls="minDistance: 0.5; maxDistance: 180; initialPosition: 0 10 30; screenSpacePanning: true;"
    >
    </a-entity>

    <!-- Oculus Quest 2 kontrolieru pievienošana kreisajai un labajai rokai -->
    <a-entity 
      id="leftHandController" 
      oculus-touch-controls="hand: left" 
      raycaster="showLine: true; objects: .grabbable"
    ></a-entity>

    <a-entity 
      id="rightHandController" 
      oculus-touch-controls="hand: right" 
      raycaster="showLine: true; objects: .grabbable"
    ></a-entity>
  </a-entity>

  <!-- Apgaismo visu ainu: -->
  <a-entity light="type: ambient; color: #AAA"></a-entity>
  <a-entity light="type: directional; color: #DDD; intensity: 0.6" position="0.7 0.4 -1"></a-entity>

  <!-- Ūdenspolo bumbas modeļa (OBJ) ielāde -->
  <a-assets>
    <a-asset-item id="water-polo-ball-obj" src="/assets/models/water_polo_goal_FINAL.obj"></a-asset-item>
    <a-asset-item id="water-polo-ball-mtl" src="/assets/models/water_polo_goal_FINAL.mtl"></a-asset-item>
  </a-assets>

  <a-entity 
    id="goal"
    obj-model="obj: #water-polo-ball-obj; mtl: #water-polo-ball-mtl"
    position="0 0 -15"
    scale="15 15 15"
    rotation="0 -90 0"
    float-in-water="minAmplitude: -1; maxAmplitude: 0.5"
  ></a-entity>

  <a-entity
    bind:this={waterPoloBall}
    id="ball"
    gltf-model="url(/assets/models/water_polo_ball_FINAL_v2.glb)" 
    position="0 -1 -5"
    scale="1 1 1"
    float-in-water="minAmplitude: -1; maxAmplitude: 0.4"
    class="grabbable"
  ></a-entity>

  <!-- Piemērs okeānam no A-Frame dokumentācijas (oriģināli no: "aframe-extras/primitives/a-ocean", pakotnes avots: https://www.npmjs.com/package/aframe-extras) -->
  <!-- <a-ocean
    color="#92E2E2"
    width="300"
    depth="300"
    density="150"
    speed="0.2"
  ></a-ocean> -->

  <a-sky-with-sun bind:this={sun} sun-position="1 1 1"></a-sky-with-sun>
</a-scene>