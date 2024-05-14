import { POOL_CONTAINER, POOL_WATER_SURFACE_NAME } from "../../helpers/consts";

const vertexShader = /* glsl */`
    uniform float time;
    varying vec2 vUv;

    void main() {
        vUv = uv;
        float freq = 2.0;
        float amp = 0.1;
        vec3 pos = position;
    
        // Periodiski maina viļņu augstumu:
        float wave = sin(pos.x * freq + time) * cos(pos.y * freq + time) * amp;
        pos.z += wave;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;

const fragmentShader = /* glsl */`
    uniform vec3 color;
    uniform float opacity;
    varying vec2 vUv;

    void main() {
        gl_FragColor = vec4(color, opacity);
    }
`;

if (!AFRAME.components['replace-water-surface']) {
    AFRAME.registerComponent('replace-water-surface', {
        schema: {
            color: { type: 'color', default: '#1e90ff' },
            opacity: { type: 'number', default: 0.5 }
        },

        init: function() {
            this.el.addEventListener('model-loaded', () => {
                const object3D = this.el.getObject3D('mesh');
                object3D.traverse(child => {
                    if (child.isMesh && child.name === POOL_WATER_SURFACE_NAME) {

                        const waterMaterial = new THREE.ShaderMaterial({
                            vertexShader,
                            fragmentShader,
                            uniforms: {
                                time: { value: 0.0 },
                                color: { value: new THREE.Color(this.data.color) },
                                opacity: { value: this.data.opacity }
                            },
                            transparent: true,
                            side: THREE.DoubleSide
                        });
            
                        child.material = waterMaterial;
                        this.data.waterMaterial = waterMaterial;
                    }
                });
            });
        },

        tick: function(time) {
            if (this.data.waterMaterial) {
                this.data.waterMaterial.uniforms.time.value = time / 1000;
            }
        }
    });
}
