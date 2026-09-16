/**
 * Unit conversion.
 *
 * Fire work moves between kPa, bar, psi and metres of head constantly — a pump
 * curve in one, a gauge in another, a standard in a third — and the arithmetic
 * is where transcription errors creep in.
 *
 * Every quantity converts through a single base unit, so adding a unit means
 * adding one factor rather than a conversion matrix.
 */

export interface Unit {
  id: string;
  label: string;
  /** Short symbol for the readout. */
  symbol: string;
  /** Multiply by this to reach the base unit. */
  toBase: number;
  /** Non-linear units (temperature) supply their own conversions. */
  toBaseFn?: (v: number) => number;
  fromBaseFn?: (v: number) => number;
}

export interface Quantity {
  id: string;
  label: string;
  /** Symbol of the base unit, for documentation. */
  base: string;
  units: Unit[];
}

export const QUANTITIES: Quantity[] = [
  {
    id: 'pressure',
    label: 'Pressure',
    base: 'Pa',
    units: [
      { id: 'kpa', label: 'Kilopascal', symbol: 'kPa', toBase: 1000 },
      { id: 'mpa', label: 'Megapascal', symbol: 'MPa', toBase: 1_000_000 },
      { id: 'bar', label: 'Bar', symbol: 'bar', toBase: 100_000 },
      { id: 'psi', label: 'Pounds per square inch', symbol: 'psi', toBase: 6894.757293168 },
      // Standard gravity against water at 4 degrees Celsius.
      { id: 'mh2o', label: 'Metres head of water', symbol: 'm H₂O', toBase: 9806.65 },
      { id: 'ftt2o', label: 'Feet head of water', symbol: 'ft H₂O', toBase: 2989.0669 },
      { id: 'pa', label: 'Pascal', symbol: 'Pa', toBase: 1 },
    ],
  },
  {
    id: 'flow',
    label: 'Flow',
    base: 'L/s',
    units: [
      { id: 'lps', label: 'Litres per second', symbol: 'L/s', toBase: 1 },
      { id: 'lpm', label: 'Litres per minute', symbol: 'L/min', toBase: 1 / 60 },
      { id: 'm3h', label: 'Cubic metres per hour', symbol: 'm³/h', toBase: 1 / 3.6 },
      { id: 'usgpm', label: 'US gallons per minute', symbol: 'US gpm', toBase: 3.785411784 / 60 },
      { id: 'impgpm', label: 'Imperial gallons per minute', symbol: 'imp gpm', toBase: 4.54609 / 60 },
    ],
  },
  {
    id: 'length',
    label: 'Length',
    base: 'm',
    units: [
      { id: 'mm', label: 'Millimetre', symbol: 'mm', toBase: 0.001 },
      { id: 'm', label: 'Metre', symbol: 'm', toBase: 1 },
      { id: 'km', label: 'Kilometre', symbol: 'km', toBase: 1000 },
      { id: 'in', label: 'Inch', symbol: 'in', toBase: 0.0254 },
      { id: 'ft', label: 'Foot', symbol: 'ft', toBase: 0.3048 },
    ],
  },
  {
    id: 'volume',
    label: 'Volume',
    base: 'L',
    units: [
      { id: 'l', label: 'Litre', symbol: 'L', toBase: 1 },
      { id: 'kl', label: 'Kilolitre', symbol: 'kL', toBase: 1000 },
      { id: 'm3', label: 'Cubic metre', symbol: 'm³', toBase: 1000 },
      { id: 'ml', label: 'Millilitre', symbol: 'mL', toBase: 0.001 },
      { id: 'usgal', label: 'US gallon', symbol: 'US gal', toBase: 3.785411784 },
      { id: 'impgal', label: 'Imperial gallon', symbol: 'imp gal', toBase: 4.54609 },
    ],
  },
  {
    id: 'temperature',
    label: 'Temperature',
    base: '°C',
    units: [
      { id: 'c', label: 'Celsius', symbol: '°C', toBase: 1 },
      {
        id: 'f', label: 'Fahrenheit', symbol: '°F', toBase: 1,
        toBaseFn: (v) => ((v - 32) * 5) / 9,
        fromBaseFn: (v) => (v * 9) / 5 + 32,
      },
      {
        id: 'k', label: 'Kelvin', symbol: 'K', toBase: 1,
        toBaseFn: (v) => v - 273.15,
        fromBaseFn: (v) => v + 273.15,
      },
    ],
  },
  {
    id: 'power',
    label: 'Power',
    base: 'W',
    units: [
      { id: 'w', label: 'Watt', symbol: 'W', toBase: 1 },
      { id: 'kw', label: 'Kilowatt', symbol: 'kW', toBase: 1000 },
      { id: 'hp', label: 'Horsepower (mechanical)', symbol: 'hp', toBase: 745.6998715823 },
      { id: 'btuh', label: 'BTU per hour', symbol: 'BTU/h', toBase: 0.29307107 },
    ],
  },
  {
    id: 'mass',
    label: 'Mass',
    base: 'kg',
    units: [
      { id: 'g', label: 'Gram', symbol: 'g', toBase: 0.001 },
      { id: 'kg', label: 'Kilogram', symbol: 'kg', toBase: 1 },
      { id: 't', label: 'Tonne', symbol: 't', toBase: 1000 },
      { id: 'lb', label: 'Pound', symbol: 'lb', toBase: 0.45359237 },
    ],
  },
];

export function quantityById(id: string): Quantity | undefined {
  return QUANTITIES.find((q) => q.id === id);
}

/** Converts a value between two units of the same quantity. */
export function convert(value: number, from: Unit, to: Unit): number {
  if (!Number.isFinite(value)) return Number.NaN;
  const base = from.toBaseFn ? from.toBaseFn(value) : value * from.toBase;
  return to.fromBaseFn ? to.fromBaseFn(base) : base / to.toBase;
}

/** Every unit of a quantity, with the value converted into each. */
export function convertAll(value: number, from: Unit, quantity: Quantity): { unit: Unit; value: number }[] {
  return quantity.units.map((u) => ({ unit: u, value: convert(value, from, u) }));
}

/**
 * Formats a converted value at a sensible precision.
 *
 * Fixed decimal places read badly across six orders of magnitude, so precision
 * follows the size of the number.
 */
export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs >= 1e6 || abs < 1e-4) return v.toExponential(3);
  const dp = abs >= 1000 ? 1 : abs >= 100 ? 2 : abs >= 1 ? 3 : 5;
  return parseFloat(v.toFixed(dp)).toString();
}
