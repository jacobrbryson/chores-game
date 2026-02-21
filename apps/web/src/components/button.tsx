"use client";

import { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ type = "button", ...props }: ButtonProps) {
  return <button type={type} {...props} />;
}

