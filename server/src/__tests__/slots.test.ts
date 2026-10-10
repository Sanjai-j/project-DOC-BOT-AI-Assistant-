import { describe, it, expect } from 'vitest';
import { formatTime12h, dateToWeekday, nextNDates, toDateStr } from '../services/slots.js';

describe('slot helpers', () => {
  it('formats 24h times as 12h with AM/PM', () => {
    expect(formatTime12h('10:00')).toBe('10:00 AM');
    expect(formatTime12h('13:30')).toBe('1:30 PM');
    expect(formatTime12h('00:15')).toBe('12:15 AM');
    expect(formatTime12h('12:00')).toBe('12:00 PM');
  });

  it('maps dates to weekdays', () => {
    expect(dateToWeekday('2026-01-04')).toBe(0); // Sunday
    expect(dateToWeekday('2026-01-05')).toBe(1); // Monday
  });

  it('generates the next N dates ascending', () => {
    const dates = nextNDates(7);
    expect(dates).toHaveLength(7);
    expect(new Date(dates[0]).getTime()).toBeLessThanOrEqual(new Date(dates[6]).getTime());
  });

  it('formats dates zero-padded', () => {
    expect(toDateStr(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
