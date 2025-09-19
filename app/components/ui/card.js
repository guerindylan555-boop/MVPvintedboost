import { forwardRef } from "react";
import { Card as HeroCard, CardBody as HeroCardBody, CardHeader as HeroCardHeader } from "@heroui/react";
import { twMerge } from "tailwind-merge";

export const Card = forwardRef(function Card({ className, shadow = "sm", radius = "lg", ...props }, ref) {
  return (
    <HeroCard
      ref={ref}
      radius={radius}
      shadow={shadow}
      className={twMerge("border border-foreground/10 bg-background/80 backdrop-blur", className)}
      {...props}
    />
  );
});

export const CardHeader = forwardRef(function CardHeader({ className, ...props }, ref) {
  return (
    <HeroCardHeader
      ref={ref}
      className={twMerge("flex flex-col gap-1 px-5 py-4", className)}
      {...props}
    />
  );
});

export const CardBody = forwardRef(function CardBody({ className, ...props }, ref) {
  return (
    <HeroCardBody
      ref={ref}
      className={twMerge("px-5 py-4", className)}
      {...props}
    />
  );
});
