"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Suggestion {
  id: string;
  text: string;
}

interface AutocompleteInputProps {
  id?: string;
  label: string;
  placeholder?: string;
  value: string;
  onTextChange: (text: string) => void;
  onSelect: (suggestion: Suggestion) => void;
  /** Supabase table to query, e.g. "companies" or "branch_addresses" */
  table: "companies" | "branch_addresses";
  /** Text column on that table, e.g. "name" or "address" */
  column: "name" | "address";
  required?: boolean;
}

const DEBOUNCE_MS = 300;

export default function AutocompleteInput({
  id,
  label,
  placeholder,
  value,
  onTextChange,
  onSelect,
  table,
  column,
  required,
}: AutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const query = value.trim();
    if (query.length === 0) {
      setSuggestions([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from(table)
          .select(`id, ${column}`)
          .ilike(column, `%${query}%`)
          .limit(8);

        if (!error && data) {
          const rows = data as unknown as Record<string, unknown>[];
          setSuggestions(
            rows.map((row) => ({
              id: String(row.id),
              text: String(row[column] ?? ""),
            }))
          );
          setIsOpen(true);
        } else {
          setSuggestions([]);
        }
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, table, column]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={id} className="label">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <input
        id={id}
        type="text"
        className="input"
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        required={required}
        onChange={(e) => {
          onTextChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setIsOpen(true);
        }}
      />
      {isOpen && (loading || suggestions.length > 0) && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          {loading && (
            <li className="px-3 py-2 text-sm text-gray-400">Searching…</li>
          )}
          {!loading &&
            suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50"
                  onClick={() => {
                    onSelect(s);
                    setIsOpen(false);
                  }}
                >
                  {s.text}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
