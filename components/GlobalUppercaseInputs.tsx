"use client";

import { useEffect } from "react";

/**
 * Auto-uppercases text as it's typed into any text input or textarea across
 * the whole app -- management wants everything encoded in all caps (started
 * as an Encode Invoices request, then generalized site-wide: "i-general
 * lang natin... puro dapat tayo capslock lang sa lahat").
 *
 * Implementation note: this listens on `document` in the CAPTURE phase so it
 * runs before React's own (bubble-phase, root-delegated) input handling.
 * Text fields must be transformed via the native HTMLInputElement/
 * HTMLTextAreaElement value setter (not a plain `el.value = ...` assignment)
 * -- React installs its own per-node setter to track the "last known value"
 * for controlled inputs, and calling that tracked setter here would mark the
 * uppercased value as already-seen, silently swallowing the onChange that
 * every field in this app relies on to update its own state. Going through
 * the native setter changes the DOM value without updating React's tracker,
 * so when the event keeps bubbling up, React still sees a value change,
 * fires the field's onChange with the uppercased value, and re-renders
 * normally with no per-field code changes needed anywhere else.
 *
 * Excluded, so real credentials/identifiers/numbers are never mangled:
 * - input types where case either doesn't apply or matters structurally:
 *   email, password, number, date/time variants, tel, url, search, and
 *   anything that isn't a free-text field (checkbox, radio, file, range,
 *   color, hidden)
 * - any field (or ancestor) explicitly opted out via a `data-no-uppercase`
 *   attribute -- e.g. the Login username field, since the username format
 *   hint there is specifically lowercase
 */
const EXCLUDED_INPUT_TYPES = new Set([
  "email",
  "password",
  "number",
  "date",
  "month",
  "week",
  "time",
  "datetime-local",
  "tel",
  "url",
  "search",
  "checkbox",
  "radio",
  "file",
  "range",
  "color",
  "hidden",
]);

export default function GlobalUppercaseInputs() {
  useEffect(() => {
    const inputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    const textareaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )?.set;

    function handleInput(e: Event) {
      const target = e.target;
      const isInput = target instanceof HTMLInputElement;
      const isTextarea = target instanceof HTMLTextAreaElement;
      if (!isInput && !isTextarea) return;

      if (isInput && EXCLUDED_INPUT_TYPES.has(target.type)) return;
      if (target instanceof HTMLElement && target.closest("[data-no-uppercase]")) return;

      const current = target.value;
      const upper = current.toLocaleUpperCase();
      if (current === upper) return;

      const start = target.selectionStart;
      const end = target.selectionEnd;

      if (isInput && inputValueSetter) {
        inputValueSetter.call(target, upper);
      } else if (isTextarea && textareaValueSetter) {
        textareaValueSetter.call(target, upper);
      } else {
        target.value = upper;
      }

      if (start !== null && end !== null) {
        try {
          target.setSelectionRange(start, end);
        } catch {
          // Some input types (e.g. ones excluded above) don't support
          // selection ranges -- safe to ignore.
        }
      }
    }

    document.addEventListener("input", handleInput, true);
    return () => document.removeEventListener("input", handleInput, true);
  }, []);

  return null;
}
