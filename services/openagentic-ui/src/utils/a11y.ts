/**
 * Accessibility helpers.
 *
 * Interactive non-button elements (e.g. a clickable <div>) need a keyboard
 * affordance to be operable without a mouse. `onKeyActivate` wraps a click
 * handler so that Enter / Space trigger the same action, mirroring native
 * <button> semantics. Pair it with `role="button"` + `tabIndex={0}`.
 *
 *   <div
 *     role="button"
 *     tabIndex={0}
 *     onClick={doThing}
 *     onKeyDown={onKeyActivate(doThing)}
 *   />
 */
import type { KeyboardEvent } from 'react';

export function onKeyActivate<T = Element>(
  handler: (e: KeyboardEvent<T>) => void,
): (e: KeyboardEvent<T>) => void {
  return (e: KeyboardEvent<T>) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      handler(e);
    }
  };
}
