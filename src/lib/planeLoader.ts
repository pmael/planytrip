// The PlanyTrip loading animation as a function of time (components/PlaneLoader.tsx draws it): the box draws itself with
// its plane, stretches along a dotted road, the plane swoops to the other end over the dots, and the box closes again,
// either on the icon or leaving the name behind it. Pure: where everything is at a given millisecond, so it is drawn at
// whatever rate the screen has, and the end of a loop is exactly its beginning.

/** The box closed on the plane (the icon) is a square this high; stretched, it is `ROAD_WIDTH` wide */
export const BOX = 92;
export const ROAD_WIDTH = 384;
/** The icon beside "Plany" over "Trip" */
export const NAME_HEIGHT = 183;
/** The plane's four points in the icon: the wing tips, the nose, and where the fold meets the tail */
export const PLANE = { top: [58, 19.5], left: [19.5, 58.5], nose: [78, 78], fold: [46, 46] } as const;
/** What the plane turns around */
export const PIVOT = 52;

const DOT_COUNT = 11;
export const DOTS = Array.from({ length: DOT_COUNT }, (_, i) => ({ x: 105 + i * 25, y: 78 }));

/** The box and the plane draw themselves, once */
export const INTRO_MS = 1150;
/** One loop: with the name, it stays a moment to be read */
export const LOOP_MS = { icon: 2700, name: 4800 } as const;

const clamp = (value: number) => Math.min(1, Math.max(0, value));
/** How far `t` is between two moments, 0 to 1 */
const span = (t: number, from: number, to: number) => clamp((t - from) / (to - from));
const smooth = (p: number) => p * p * (3 - 2 * p);
/** Starts and stops gently, quick in between: how a thing with some weight moves */
const glide = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
/** The same, softer: how a thing flies */
const sway = (p: number) => (1 - Math.cos(Math.PI * p)) / 2;
/** Leaves at once and settles slowly */
const settle = (p: number) => 1 - (1 - p) ** 4;
const mix = (from: number, to: number, p: number) => from + (to - from) * p;

export type LoaderPose = {
  /** Its outline: `drawn` is how much of it there is, from the top left corner, clockwise */
  box: { x: number; y: number; width: number; drawn: number };
  /** `rotation` in degrees around its middle; `wings`, `belly` and `edge` are how much of its lines is drawn */
  plane: { x: number; y: number; rotation: number; wings: number; belly: number; edge: number };
  /** Each dot's size, 0 (not there, or eaten) to 1 */
  dots: number[];
  /** Each letter of the name, in `NAME_LETTERS`' order */
  letters: { opacity: number; rise: number; shine: number }[];
};

/** Where everything is `ms` after the loader appeared. `name`: the box leaves "Plany Trip" behind it as it closes. */
export function loaderPose(ms: number, name = false): LoaderPose {
  const height = name ? NAME_HEIGHT : BOX;
  const middle = (height - BOX) / 2;
  const centred = (ROAD_WIDTH - BOX) / 2;
  const t = ms < INTRO_MS ? 0 : (ms - INTRO_MS) % (name ? LOOP_MS.name : LOOP_MS.icon);

  // The box stretches from its middle, then closes: on its middle, or on its left edge for the name
  const stretch = sway(span(t, 0, 640));
  const close = sway(span(t, 1700, name ? 2480 : 2440));
  const leave = name ? glide(span(t, 4020, 4700)) : 0;
  const left = name ? mix(mix(centred, 0, stretch), centred, leave) : mix(mix(centred, 0, stretch), centred, close);
  const right = name ? mix(mix(mix(centred + BOX, ROAD_WIDTH, stretch), BOX, close), centred + BOX, leave) : mix(mix(centred + BOX, ROAD_WIDTH, stretch), centred + BOX, close);
  const y = name ? middle * (1 - close + leave) : 0;

  // The plane flies from the left edge to the right one, nose up in the middle of the way
  const flown = sway(span(t, 590, 1640));
  const swoop = Math.sin(Math.PI * smooth(span(t, 580, 1650)));
  const planeX = mix(left, right - BOX, flown);
  const rotation = -24 * swoop;

  const angle = (rotation * Math.PI) / 180;
  const reach = PLANE.nose[0] - PIVOT;
  const nose = planeX + PIVOT + reach * (Math.cos(angle) - Math.sin(angle));
  const dots = DOTS.map(({ x }) => (close > 0 ? 0 : smooth(span(right - x, 2, 28)) * smooth(span(x - nose, -8, 24))));

  const letters = NAME_LETTERS.map((letter) => {
    if (!name) return { opacity: 0, rise: 0, shine: 0 };
    // Each letter comes out from under the box's right edge, and they go as they came
    const out = close > 0 ? smooth(span(letter.left - right, -30, 8)) : 0;
    const gone = smooth(span(t, 3760 + (ROAD_WIDTH - letter.left) * 0.7, 4020 + (ROAD_WIDTH - letter.left) * 0.7));
    const shine = Math.max(0, Math.sin(Math.PI * span(t, 2500 + letter.left * 2.1, 2860 + letter.left * 2.1)));
    return { opacity: out * (1 - gone), rise: 10 * (1 - out) - 6 * gone, shine };
  });

  return {
    box: { x: left, y, width: right - left, drawn: glide(span(ms, 80, 720)) },
    plane: {
      x: planeX,
      y: y - 4 * swoop,
      rotation,
      wings: settle(span(ms, 420, 820)),
      belly: settle(span(ms, 600, 960)),
      edge: settle(span(ms, 700, 1060)),
    },
    dots,
    letters,
  };
}

/** Standing still, for people who asked for reduced motion: the icon, with the name when there is one */
export function stillPose(name = false): LoaderPose {
  return loaderPose(INTRO_MS + (name ? 3700 : 0), name);
}

/** The name's letters, beside and under the icon: traced from the brand's logo (public/brand/logo-icon-stacked.png) */
export const NAME_LETTERS: { letter: string; left: number; path: string }[] = [
  { letter: "P", left: 107, path: "M108.5 81.8C107.5 81.5 107.6 84.8 107.6 47.9C107.6 22.1 107.7 15 107.8 14.8C108.2 13.9 107.3 13.9 120.3 13.9C133.4 13.9 133.1 13.9 136.6 14.9C139.6 15.7 140.8 16.2 143.3 17.8C154.3 24.9 154.7 43.9 144 51.1C138.6 54.7 135.6 55.4 124.2 55.5C116.8 55.6 116.8 55.6 116.4 55.9C115.9 56.4 115.9 56.7 115.9 69.1C115.9 82.2 115.9 81.6 115.1 81.9C114.6 82.1 109.1 82 108.5 81.8ZM131.6 47.1C138.7 46.2 142.6 42.5 143 36.2C143.6 28 139.6 23.1 131.3 22.1C129.5 21.9 117 21.9 116.6 22.1C115.9 22.5 115.9 22 115.9 34.7C115.9 47.8 115.9 46.9 116.8 47.4C117.3 47.6 129.1 47.5 131.6 47.1Z" },
  { letter: "l", left: 162, path: "M163.3 81.9C162.4 81.6 162.4 81.4 162.4 78.5C162.4 74.5 161.2 75 172.7 74.9C182.3 74.8 182.3 74.8 182.6 74.2C182.8 73.8 182.8 27.2 182.6 26C182.2 23.8 181.3 22.6 179.4 21.7L178.2 21.1L171.6 21C163.4 20.9 164.2 21.3 164.2 17.4C164.2 14.3 164.3 14.1 165.6 13.9C166.7 13.8 179.6 14 180.4 14.1C185.2 15 188.8 18.2 190.1 22.6C190.9 25.3 190.8 23.1 190.9 49.7C190.9 68.8 191 74 191.1 74.2C191.5 74.9 191.2 74.9 199.2 74.9C209.2 74.9 208.3 74.6 208.3 78.3C208.4 81.2 208.3 81.6 207.5 81.8C207 82 163.9 82 163.3 81.9Z" },
  { letter: "a", left: 219, path: "M233.5 83C223.5 82 217.6 74.5 219.7 65.5C221.1 59.5 226.9 55.3 235.5 53.9C236.2 53.8 237.4 53.6 238.1 53.4C238.8 53.3 239.8 53.1 240.2 53C240.7 52.9 242 52.7 243.1 52.4C244.3 52.2 245.9 51.9 246.8 51.7C252.4 50.6 252.4 50.6 252.4 48.7C252.3 43.4 249 38.9 244.7 38.1C237.5 36.7 232.4 38.8 229.7 44.3C228.4 47 228.8 46.8 224.6 46.4C220.3 46 220.2 46 220.9 43.6C225.5 27.7 250.9 24.8 258.2 39.4C259.2 41.4 259.8 43.6 260.4 47.1C260.5 47.7 260.6 51.9 260.6 60.3C260.7 72.5 260.7 72.7 260.9 73.2C261.5 74.5 262.3 74.9 264.2 74.9C266.8 74.9 266.9 74.9 266.9 78.5C266.9 82.2 267 82.1 263.4 82.1C258 82.1 255.6 81 253.8 77.7C252.8 75.7 252.6 75.7 251.2 77.1C247.3 81.5 240.8 83.7 233.5 83ZM240.4 75.9C248.3 74.7 252.4 69.7 252.4 61.3C252.4 57.3 252.3 57.2 246.9 58.5C246.2 58.7 245.1 58.9 244.6 59C244 59.1 243 59.3 242.4 59.4C241.7 59.6 240.6 59.8 239.8 59.9C231.4 61.2 227.9 63.7 227.9 68.5C227.9 72.2 229.3 74.2 232.9 75.5C234.3 76 238.3 76.2 240.4 75.9Z" },
  { letter: "n", left: 279, path: "M280.5 81.8C280.2 81.6 280 81.4 279.9 81.1C279.7 80.6 279.7 32.8 279.9 32.1C280.1 31.2 280.2 31.2 283.4 31.1C287.2 31.1 287.1 30.9 287.2 34.9C287.3 38.6 287.6 38.8 289.4 36.5C293.2 31.6 299.9 29.1 306.8 30.2C314.8 31.4 320.4 37.9 321.1 46.9C321.3 50.1 321.3 80.4 321.1 81.1C320.7 82.3 313.8 82.5 313.3 81.3C313.2 81 313.1 76.6 313.1 64.5C313 46.4 313.1 47.6 312.2 44.6C309.2 34.1 293 34.7 288.9 45.4C287.9 48 287.9 48 287.9 65.8C287.9 82.5 287.9 81.6 287.1 81.9C286.4 82.1 281 82 280.5 81.8Z" },
  { letter: "y", left: 334, path: "M343.7 96.3C342.6 96 342.5 95.5 342.5 92.5C342.6 89.1 342.4 89.3 347.1 89.2C352.7 89.1 353.2 88.8 355.2 83.4C355.9 81.6 355.8 81.2 354.5 81C353.7 80.8 353.3 80.6 353.1 80.2C352.8 79.6 351.2 75.4 351 74.8C350.9 74.4 350.7 73.9 350.5 73.6C350.4 73.2 350.1 72.5 349.9 71.9C349.7 71.4 349.3 70.3 349 69.6C348.7 68.9 348.3 67.6 347.9 66.8C347.6 65.9 347.1 64.7 346.9 64.1C346.7 63.4 346.3 62.4 346 61.8C345.8 61.1 345.4 59.9 345 59.1C344.7 58.3 344.3 57.1 344 56.4C343.7 55.7 343.3 54.5 343.1 53.9C342.8 53.2 342.4 52.2 342.2 51.6C342 50.9 341.5 49.8 341.2 48.9C340.9 48.1 340.4 46.9 340.2 46.2C339.9 45.5 339.6 44.7 339.5 44.5C339.3 44.2 339.1 43.5 338.9 43.1C338.8 42.6 338.3 41.4 337.9 40.4C337.5 39.4 337 38.1 336.8 37.4C336.3 36.1 335.6 34.4 335.3 33.4C334.4 31.3 334.7 31.1 339 31.1C343.8 31.1 343 30.3 346 38.7C346.3 39.4 346.7 40.6 347 41.3C347.3 42.1 347.7 43.3 348 44.1C348.3 44.9 348.7 46.1 349 46.9C349.3 47.7 349.7 48.9 350 49.6C350.3 50.3 350.9 52.2 351.5 53.7C352 55.2 352.5 56.6 352.6 56.7C352.7 56.9 352.9 57.5 353.1 58.1C353.6 59.4 354.8 62.9 356.2 66.6C356.4 67.2 356.9 68.4 357.1 69.2C358.5 73.2 358.9 73.1 360.4 68.5C360.9 67.1 361.5 65.2 361.9 64.2C363 61.1 364.4 56.9 365.9 52.4C366.7 50.1 367.8 46.9 368.4 45.2C370.5 39 371.7 35.8 372.2 34.2C373.2 31 373 31.1 377.4 31.1C382 31.1 382 31.1 381.1 33.6C380.9 34.4 380.3 36.1 379.8 37.4C379.4 38.6 378.8 40.1 378.7 40.5C378.5 40.9 377.9 42.5 377.4 43.9C376.9 45.4 376.3 47.2 376 47.9C375.7 48.7 375.3 49.9 375 50.7C374.8 51.4 374.3 52.8 373.9 53.6C373.6 54.5 373.2 55.8 372.9 56.4C372.7 57.1 372.3 58.2 372.1 58.9C371.8 59.5 371.4 60.7 371.1 61.4C370.9 62.2 370.4 63.6 370 64.6C369.6 65.5 368.9 67.5 368.4 68.9C367.9 70.4 367.4 71.9 367.2 72.3C367 72.7 366.6 74 366.2 75.1C365.8 76.2 365.2 77.8 364.9 78.6C364.6 79.5 364.2 80.8 363.9 81.4C363.7 82.1 363.3 83.2 363.1 83.9C362.8 84.5 362.4 85.6 362.2 86.3C359.3 94.6 356.6 96.4 347.3 96.4C345.5 96.4 343.9 96.3 343.7 96.3Z" },
  { letter: "T", left: 102, path: "M124.5 167.8C123.5 167.5 123.6 170.3 123.6 137.9C123.6 115.8 123.6 108.9 123.5 108.7C123.1 107.9 123.5 107.9 113.1 107.9C101.5 107.8 102.8 108.4 102.9 103.4C102.9 100.7 103 100.5 103.5 100.1C103.9 99.9 150.5 99.8 151.6 100C152.7 100.2 152.8 100.3 152.8 103.8C152.8 107 152.7 107.4 152.2 107.7C152 107.8 147.6 107.8 142.4 107.9C134.5 107.9 132.8 108 132.5 108.1C131.9 108.5 131.9 106.6 131.9 138C131.8 169.6 131.9 167.6 131.1 167.9C130.6 168.1 125.1 168 124.5 167.8Z" },
  { letter: "r", left: 165, path: "M166.2 167.9C165.3 167.6 165.2 167.4 165.2 164.4C165.2 160.6 164.7 160.9 172.1 160.9C178.2 160.9 178.1 160.9 178.4 159.9C178.6 159 178.5 125.3 178.2 124.9C177.8 124.3 177.8 124.3 171.9 124.3C164.6 124.2 165.2 124.5 165.2 120.6C165.2 116.7 164.1 117.1 175.3 117.1C186.3 117.1 185 116.7 185.3 120.4C185.7 124.7 186 125.1 187.4 122.7C188.8 120.3 191 118.5 193.4 117.8C195.5 117.2 195.9 117.1 201.8 117.1C209 117.1 208.4 116.8 208.4 121C208.3 124.6 208.7 124.4 202.1 124.4C191.7 124.4 188.2 126.5 186.9 133.5C186.5 135.2 186.3 158.9 186.6 159.9C186.9 160.8 186.6 160.8 194.5 160.9C203.5 161 202.6 160.6 202.6 164.6C202.6 167.4 202.6 167.6 201.7 167.9C201.1 168 166.6 168 166.2 167.9Z" },
  { letter: "i", left: 221, path: "M222.5 167.8C221.8 167.4 221.7 167 221.8 164.2C221.8 160.6 220.6 161 232.2 160.9C242.7 160.8 242 160.9 242.2 159.6C242.4 158.1 242.2 125.3 242 124.9C241.6 124.3 241.8 124.3 232.5 124.2C221.7 124.2 222.7 124.6 222.8 120.4C222.8 117.8 222.9 117.5 223.6 117.2C224.2 117 249.2 117.1 249.6 117.3C250.4 117.7 250.3 116.4 250.4 139.1C250.4 160.1 250.4 160.1 250.8 160.5C251.1 160.8 251.1 160.8 259 160.9C268.9 161 267.9 160.5 267.9 164.4C267.9 167.3 267.8 167.6 267.1 167.9C266.3 168.1 223 168 222.5 167.8ZM242.8 109C241.5 108.8 241.5 108.7 241.5 104.4C241.5 99.5 241.2 99.8 245.7 99.8C250.2 99.8 249.9 99.4 249.9 104.6C249.9 108.7 249.9 108.7 248.9 109C248.5 109.1 243.3 109.2 242.8 109Z" },
  { letter: "p", left: 279, path: "M280.5 182.3C280.3 182.2 279.9 182 279.8 181.8C279.2 181.3 279.3 118.1 279.8 117.5C280.1 117.2 280.1 117.2 283 117.1C287 117.1 286.8 117 286.9 120.3C287 123.6 287.3 124.2 288.3 122.9C293.4 116.6 300.9 114.5 309.5 116.9C326.9 121.9 330.1 155.3 314.2 166C307.3 170.6 295.4 170 290.4 164.9C288.7 163.1 287.8 162.6 287.5 163.3C287.4 163.5 287.4 167 287.4 172.3C287.4 181.6 287.4 181.6 286.7 182.1C286.3 182.3 281.5 182.5 280.5 182.3ZM304.4 161.2C312.6 159.8 317 151.2 315.9 138.8C314.9 128.8 308.6 122.8 300 123.8C292.1 124.8 287.9 130.7 287.4 141.3C286.9 155.1 293.7 163 304.4 161.2Z" },
];
