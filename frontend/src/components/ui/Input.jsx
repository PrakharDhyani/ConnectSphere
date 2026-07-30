/**
 * Form input with label + inline error. forwardRef is required so
 * react-hook-form's register() can attach its ref: <Input {...register("email")} />
 */
import { forwardRef } from "react";

const Input = forwardRef(function Input({ label, error, ...props }, ref) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-300 mb-1">{label}</span>
      <input
        ref={ref}
        className={`w-full px-3 py-2 rounded-lg bg-gray-900 border text-white placeholder-gray-500
          focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent
          ${error ? "border-red-500" : "border-gray-700"}`}
        {...props}
      />
      {error && <span className="block text-sm text-red-400 mt-1">{error}</span>}
    </label>
  );
});

export default Input;
