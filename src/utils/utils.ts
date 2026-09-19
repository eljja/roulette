export function rad(degree: number) {
  return (Math.PI * degree) / 180;
}

export function getRotationRad(rotation?: number): number {
  if (!rotation) return 0;
  // If absolute value > 2*PI, it was specified in degrees (e.g. 45, -45, 90, -90). Convert to radians.
  // Otherwise, it is already in radians (e.g. 0.785398... = PI/4).
  return Math.abs(rotation) > Math.PI * 2 ? (rotation * Math.PI) / 180 : rotation;
}

function getRegexValue(regex: RegExp, str: string) {
  const result = regex.exec(str);
  return result ? result[1] : '';
}

export function parseName(nameStr: string) {
  const weightRegex = /\/(\d+)/;
  const countRegex = /\*(\d+)/;
  const hasWeight = weightRegex.test(nameStr);
  const hasCount = countRegex.test(nameStr);
  const name = getRegexValue(/^\s*([^/*]+)?/, nameStr);
  if (!name) return null;
  const weight = hasWeight ? parseInt(getRegexValue(weightRegex, nameStr), 10) : 1;
  const count = hasCount ? parseInt(getRegexValue(countRegex, nameStr), 10) : 1;
  return {
    name,
    weight,
    count,
  };
}

export function pad(v: number) {
  return v.toString().padStart(2, '0');
}

export function shuffle<T>(originalArray: T[]): T[] {
  const array = originalArray.slice();
  let currentIndex = array.length;
  let randomIndex;

  // While there remain elements to shuffle.
  while (currentIndex !== 0) {
    // Pick a remaining element.
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }

  return array;
}
