"use client";

export function GithubToolsToggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`toolsToggle ${checked ? "on" : ""}`}
      title="GitHub tools use more tokens (tool schemas + multi-round). Off by default."
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span>GitHub tools</span>
    </label>
  );
}
