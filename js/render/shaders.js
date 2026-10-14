// GLSL shaders for the planet, clouds, atmosphere deck and limb glow.

export const NOISE_GLSL = /* glsl */`
// Ashima / Stefan Gustavson 3D simplex noise
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p, int oct){
  float a=0.5, s=0.0;
  for(int i=0;i<8;i++){ if(i>=oct) break; s+=a*snoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; }
  return s;
}
`;

const BAND_GLSL = /* glsl */`
uniform sampler2D uBandA;   // r: T (K/400), g: sea-ice frac, b: land snow frac, a: ice-sheet cover
uniform sampler2D uBandB;   // r: cloud frac, g: cloud tau/40, b: precip (m/yr)/3, a: CO2 ice
uniform float uLocked;
uniform vec3 uSubstellar;   // object space
float bandCoord(vec3 p){
  float x = uLocked > 0.5 ? dot(p, uSubstellar) : p.y;
  return (asin(clamp(x,-1.0,1.0)) / 3.14159265 + 0.5);
}
`;

export const surfaceVert = /* glsl */`
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorld;
void main(){
  vPos = normalize(position);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position,1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const surfaceFrag = /* glsl */`
precision highp float;
${NOISE_GLSL}
${BAND_GLSL}
uniform sampler2D uHeight;
uniform vec2 uHeightSize;
uniform float uSeaLevel;     // km (Earth-normalised height units)
uniform float uHasOcean;
uniform vec3 uSunDirW;       // world space, towards the star
uniform vec3 uStarColor;
uniform float uTime;
uniform float uLife;
uniform float uDesertTint;   // global aridity
uniform float uRust;         // oxidised regolith (water-poor worlds)
uniform float uHot;          // 0..1 scorched surface
uniform mat3 uObjToWorld;
uniform float uExposure;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorld;

const float PI = 3.14159265;

vec2 equirect(vec3 p){
  float lat = asin(clamp(p.y,-1.0,1.0));
  float lon = atan(p.z, p.x);
  return vec2((lon + PI) / (2.0*PI), (PI*0.5 - lat) / PI);
}
float heightAt(vec3 p){ return texture2D(uHeight, equirect(p)).r; }

vec3 blackbody(float T){
  // approximate blackbody colour (Tanner Helland fit), T in K
  float t = T/100.0;
  vec3 c;
  c.r = t<=66.0 ? 1.0 : clamp(1.292936*pow(t-60.0,-0.1332047),0.0,1.0);
  c.g = t<=66.0 ? clamp(0.3900816*log(t)-0.6318414,0.0,1.0) : clamp(1.1298909*pow(t-60.0,-0.0755148),0.0,1.0);
  c.b = t>=66.0 ? 1.0 : (t<=19.0 ? 0.0 : clamp(0.5432068*log(t-10.0)-1.1962541,0.0,1.0));
  return c;
}

void main(){
  vec3 p = normalize(vPos);
  float h = heightAt(p);
  // bump normal from the height field
  vec3 tA = normalize(cross(abs(p.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0), p));
  vec3 tB = cross(p, tA);
  // central differences over ~3 texels (avoids terracing artefacts) plus fine procedural relief
  float e = 3.0 / uHeightSize.x * 6.2832;
  float hA = heightAt(normalize(p + tA*e)) - heightAt(normalize(p - tA*e));
  float hB = heightAt(normalize(p + tB*e)) - heightAt(normalize(p - tB*e));
  vec3 gN = (tA*hA + tB*hB) / (2.0*e);
  vec3 det = vec3(snoise(p*60.0), snoise(p*60.0+17.0), snoise(p*60.0+31.0)) * 0.06;
  vec3 nObj = normalize(p - gN * 0.0045 + det * smoothstep(0.0, 1.0, h - uSeaLevel + 0.5) * 0.35);

  float bc = bandCoord(p);
  vec4 A = texture2D(uBandA, vec2(bc, 0.5));
  vec4 B = texture2D(uBandB, vec2(bc, 0.5));
  float T = A.r * 400.0;
  float seaIce = A.g, snow = A.b, sheet = A.a;
  float precip = B.b * 3.0;
  float co2 = B.a;

  float n1 = fbm(p*7.0, 4);
  float n2 = fbm(p*31.0 + 4.0, 3);
  float n3 = snoise(p*90.0);

  float depth = uSeaLevel - h;
  bool ocean = uHasOcean > 0.5 && depth > 0.0;
  vec3 col;
  float spec = 0.0;
  float rough = 1.0;
  vec3 emission = vec3(0.0);

  // local temperature with lapse rate for land
  float Tl = T - max(0.0, h - max(uSeaLevel,0.0)) * 6.5;

  if (ocean) {
    // sea surface: no bathymetry bump, just a gentle wave normal
    vec3 wv = vec3(snoise(p*180.0 + uTime*0.05), snoise(p*180.0 + 11.0 - uTime*0.05), snoise(p*180.0 + 23.0));
    nObj = normalize(p + wv * 0.012);
    float d = clamp(depth / 4.0, 0.0, 1.0);
    vec3 shallow = vec3(0.10, 0.42, 0.50);
    vec3 deep = vec3(0.012, 0.05, 0.13);
    col = mix(shallow, deep, smoothstep(0.0, 0.6, pow(d,0.5)));
    // hot ocean darkens / steams
    col = mix(col, vec3(0.05,0.07,0.08), smoothstep(330.0, 420.0, T));
    spec = 1.0; rough = 0.15;
    // sea ice with ragged edges
    float iceN = seaIce + 0.22*n2 + 0.08*n3;
    float ice = smoothstep(0.42, 0.58, iceN);
    vec3 iceCol = mix(vec3(0.72,0.82,0.90), vec3(0.95,0.97,1.0), smoothstep(0.4,0.9,seaIce));
    col = mix(col, iceCol, ice);
    spec *= 1.0 - ice;
  } else {
    // bare rock / soil palette
    vec3 basalt = vec3(0.20,0.18,0.17);
    vec3 soil = mix(vec3(0.36,0.28,0.20), vec3(0.45,0.36,0.26), n2*0.5+0.5);
    vec3 sand = mix(vec3(0.78,0.62,0.40), vec3(0.85,0.70,0.48), n2*0.5+0.5);
    vec3 rust = vec3(0.62,0.33,0.18);
    float arid = clamp(1.0 - precip/0.6, 0.0, 1.0);
    arid = max(arid, uDesertTint);
    vec3 ground = mix(soil, sand, smoothstep(0.35, 0.9, arid + 0.15*n1));
    ground = mix(ground, rust, uDesertTint * 0.5 * smoothstep(0.0,0.8,arid));
    vec3 regolith = mix(vec3(0.55,0.27,0.13), vec3(0.70,0.42,0.24), n2*0.5+0.5);
    regolith = mix(regolith, vec3(0.30,0.20,0.15), smoothstep(0.2, 0.8, n1) * 0.5);
    ground = mix(ground, regolith, uRust);
    ground = mix(ground, basalt, smoothstep(1.5, 4.0, h) * 0.6);
    // vegetation where warm and wet (only with a biosphere)
    float veg = uLife * smoothstep(272.0, 285.0, Tl) * (1.0 - smoothstep(305.0, 318.0, Tl)) * smoothstep(0.25, 0.9, precip);
    vec3 forest = mix(vec3(0.07,0.20,0.06), vec3(0.17,0.30,0.09), smoothstep(290.0, 300.0, Tl));
    vec3 grass = vec3(0.32,0.38,0.16);
    vec3 green = mix(grass, forest, smoothstep(0.6, 1.4, precip));
    col = mix(ground, green, veg * (0.75 + 0.25*n1));
    // tundra browns
    col = mix(col, vec3(0.38,0.33,0.26), uLife * smoothstep(275.0, 266.0, Tl) * (1.0-smoothstep(262.0, 255.0, Tl)) * 0.6);
    // scorched surface on hot worlds
    col = mix(col, mix(basalt, vec3(0.30,0.22,0.17), n2*0.5+0.5), uHot);
    // snow / ice sheets
    float sn = max(sheet, snow * (0.6 + 0.4*smoothstep(0.0, 2.0, h)));
    float snowN = sn + 0.18*n2 + 0.12*smoothstep(1.0, 3.5, h);
    float s = smoothstep(0.45, 0.6, snowN);
    col = mix(col, vec3(0.93,0.95,0.98), s);
    rough = 0.9;
  }
  // CO2 frost caps
  col = mix(col, vec3(0.95,0.92,0.93), smoothstep(0.3, 0.7, co2 + 0.15*n2));

  // lava / incandescent surface
  if (T > 650.0) {
    float cracks = 1.0 - abs(fbm(p*14.0 + vec3(0.0, uTime*0.002, 0.0), 4));
    cracks = pow(clamp(cracks,0.0,1.0), 6.0);
    float glowT = T * (0.85 + 0.25*cracks);
    float g = smoothstep(650.0, 1500.0, T);
    vec3 bb = blackbody(glowT);
    float I = pow(glowT/1500.0, 4.0) * (0.25 + 1.8*cracks) * g;
    emission = bb * I * 1.6;
    col = mix(col, vec3(0.08,0.06,0.05), g*0.8);
  }

  vec3 N = normalize(uObjToWorld * nObj);
  vec3 L = normalize(uSunDirW);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndl = dot(N, L);
  float diff = max(ndl, 0.0);
  float wrap = smoothstep(-0.12, 0.25, dot(normalize(vNormalW), L));
  vec3 light = uStarColor * (diff * 1.15) * wrap;
  vec3 c = col * (light + vec3(0.003,0.0035,0.005));
  if (spec > 0.0) {
    vec3 H = normalize(L + V);
    float sp = pow(max(dot(N, H), 0.0), 260.0) * 1.1 + pow(max(dot(N, H), 0.0), 24.0) * 0.05;
    float fres = 0.02 + 0.98*pow(1.0 - max(dot(N, V), 0.0), 5.0);
    c += uStarColor * sp * spec * wrap;
    c = mix(c, vec3(0.20,0.30,0.45) * wrap * diff, fres * 0.25 * spec);
  }
  c += emission;
  gl_FragColor = vec4(c * uExposure, 1.0);
}
`;

export const cloudFrag = /* glsl */`
precision highp float;
${NOISE_GLSL}
${BAND_GLSL}
uniform vec3 uSunDirW;
uniform vec3 uStarColor;
uniform float uTime;
uniform float uStorm;      // 0..1 extra turbulence (hot regimes)
uniform mat3 uObjToWorld;
uniform float uExposure;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorld;
void main(){
  vec3 p = normalize(vPos);
  float bc = bandCoord(p);
  vec4 B = texture2D(uBandB, vec2(bc, 0.5));
  float cf = B.r;
  float tau = B.g * 40.0;
  // zonal advection: bands rotate at slightly different rates
  float lat = asin(p.y);
  float shear = uTime * (0.010 + 0.006*cos(2.0*lat));
  float cs = cos(shear), sn = sin(shear);
  vec3 q = vec3(cs*p.x - sn*p.z, p.y, sn*p.x + cs*p.z);
  // domain warp -> swirls and storm systems
  vec3 w = q*4.2 + 0.55*vec3(fbm(q*2.3+uTime*0.008, 4), fbm(q*2.3+7.0, 4), fbm(q*2.3+13.0-uTime*0.008, 4));
  float n = fbm(w, 7) + 0.28*fbm(w*3.1 + 5.0, 3);
  // streaky texture in the extratropics
  n = mix(n, fbm(vec3(q.x*3.0, q.y*18.0, q.z*3.0) + w*0.25, 5), 0.3*smoothstep(0.3,0.8,abs(p.y)));
  // map the noise (≈ Gaussian) so the covered area equals the simulated cloud fraction
  float z = n / 0.2;
  float pc = clamp(1.0 - cf, 0.002, 0.998);
  float zt = 4.91 * (pow(pc, 0.14) - pow(1.0 - pc, 0.14));   // inverse normal CDF (Tukey lambda)
  float cov = smoothstep(zt - 0.6, zt + 0.5, z);
  float core = smoothstep(zt, zt + 1.6, z);
  float dens = cov * (1.0 - exp(-tau / 2.2)) * (0.45 + 0.55 * core);
  // cheap self-shadowing: denser cloud slightly towards the star -> darker
  vec3 ws = w + normalize(uSubstellar) * 0.08;
  float ns = (fbm(ws, 4)) / 0.2;
  float shadow = clamp((ns - z) * 0.25, -0.2, 0.35);
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uSunDirW);
  float d = dot(N, L);
  float lit = smoothstep(-0.15, 0.35, d);
  vec3 col = uStarColor * (0.06 + 1.0*max(d,0.0)) * lit * (1.0 - shadow) + vec3(0.002);
  // forward-scattering silver lining near the terminator
  vec3 V = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += uStarColor * rim * 0.25 * lit;
  gl_FragColor = vec4(col * uExposure, dens * 0.92);
}
`;

export const deckFrag = /* glsl */`
precision highp float;
${NOISE_GLSL}
uniform vec3 uSunDirW;
uniform vec3 uStarColor;
uniform vec3 uDeckColor;
uniform float uOpacity;
uniform float uTime;
uniform float uGlow;        // thermal glow from a hot deep atmosphere
uniform vec3 uGlowColor;
uniform float uExposure;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorld;
void main(){
  vec3 p = normalize(vPos);
  float lat = asin(p.y);
  float sh = uTime * 0.02;
  vec3 q = vec3(cos(sh)*p.x - sin(sh)*p.z, p.y, sin(sh)*p.x + cos(sh)*p.z);
  // Venus-like banded streaks (super-rotation)
  float bands = fbm(vec3(q.x*1.5, q.y*9.0, q.z*1.5) + fbm(q*3.0, 3)*0.8, 5);
  vec3 col = uDeckColor * (0.86 + 0.22*bands);
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uSunDirW);
  float d = dot(N, L);
  float lit = smoothstep(-0.2, 0.3, d);
  vec3 c = col * uStarColor * (0.08 + 1.0*max(d,0.0)) * lit;
  c += uGlowColor * uGlow * (0.6 + 0.4*bands) * (1.0 - 0.5*lit);
  gl_FragColor = vec4(c * uExposure, uOpacity);
}
`;

export const atmoVert = /* glsl */`
varying vec3 vNormalW;
varying vec3 vWorld;
void main(){
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position,1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const atmoFrag = /* glsl */`
precision highp float;
uniform vec3 uSunDirW;
uniform vec3 uStarColor;
uniform vec3 uRayleigh;     // scattering colour
uniform float uStrength;
uniform float uExposure;
varying vec3 vNormalW;
varying vec3 vWorld;
void main(){
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  float vn = dot(N, V);
  // limb: strongest where the view grazes the shell
  float limb = pow(clamp(1.0 - abs(vn), 0.0, 1.0), 3.0);
  vec3 L = normalize(uSunDirW);
  float day = smoothstep(-0.35, 0.4, dot(N, L));
  // forward-scattering glow when looking towards the star
  float fwd = pow(max(dot(-V, L), 0.0), 6.0) * smoothstep(-0.3, 0.1, dot(N, L));
  vec3 c = uRayleigh * uStarColor * (limb * day * 1.6 + fwd * 0.9);
  float a = clamp((limb * day + fwd*0.5) * uStrength, 0.0, 1.0);
  gl_FragColor = vec4(c * uExposure * uStrength, a);
}
`;
