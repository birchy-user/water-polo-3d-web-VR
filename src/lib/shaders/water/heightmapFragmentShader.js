// Avots: https://github.com/mrdoob/three.js/blob/master/examples/webgl_gpgpu_water.html
export const heightMapFragmentShader = /* glsl */`
    #include <common>

    uniform vec2 mousePos;              // peles kursora NDC koordinātas
    uniform float mouseSize;            // peles kursora ietekmes koeficients
    uniform float viscosityConstant;    // Ūdens virsmas stigrība jeb viskozitāte
    uniform float heightCompensation;   // TODO: Noņemt

    void main()	{

        vec2 cellSize = 1.0 / resolution.xy;

        vec2 uv = gl_FragCoord.xy * cellSize;

        // Iegūst ūdens virsmas augstumu šajā tekstūras daļā (tekselī)
        // heightmapValue.x: augstums no iepriekšējā kadra
        // heightmapValue.y: augstums no pirmspēdējā (vienu pirms iepriekšējā) kadra
        vec4 heightmapValue = texture2D( heightmap, uv );

        // Iegūst četrus tuvākos tekseļa kaimiņus
        vec4 north = texture2D( heightmap, uv + vec2( 0.0, cellSize.y ) );
        vec4 south = texture2D( heightmap, uv + vec2( 0.0, - cellSize.y ) );
        vec4 east = texture2D( heightmap, uv + vec2( cellSize.x, 0.0 ) );
        vec4 west = texture2D( heightmap, uv + vec2( - cellSize.x, 0.0 ) );

        // Algoritma avots: https://web.archive.org/web/20080618181901/http://freespace.virgin.net/hugo.elias/graphics/x_water.htm

        float newHeight = ( ( north.x + south.x + east.x + west.x ) * 0.5 - heightmapValue.y ) * viscosityConstant;

        // Izmanto peles koordinātas un kursora ietekmes koeficientu
        float mousePhase = clamp( length( ( uv - vec2( 0.5 ) ) * WATER_SURFACE_SIZE - vec2( mousePos.x, - mousePos.y ) ) * PI / mouseSize, 0.0, PI );
        newHeight += ( cos( mousePhase ) + 1.0 ) * 0.28;

        heightmapValue.y = heightmapValue.x;
        heightmapValue.x = newHeight;

        gl_FragColor = heightmapValue;
    }
`;