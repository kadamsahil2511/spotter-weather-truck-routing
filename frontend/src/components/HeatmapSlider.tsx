import { Label, Slider } from "@heroui/react";
import { useLayoutEffect, useRef } from "react";

export function HeatmapSlider({
  hour,
  label,
  onHour,
}: {
  hour: number;
  label: string;
  onHour: (hour: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    rootRef.current
      ?.querySelector<HTMLInputElement>("input[type='range']")
      ?.setAttribute("aria-valuetext", label);
  }, [label, hour]);
  return (
    <div ref={rootRef}>
    <Slider
      aria-label="Forecast hour"
      className="w-full"
      maxValue={48}
      minValue={0}
      step={1}
      value={hour}
      onChange={(value) => onHour(Array.isArray(value) ? value[0] : value)}
    >
      <div className="flex items-baseline justify-between gap-3">
        <Label>Forecast, 0–48 hours</Label>
        <Slider.Output>{label}</Slider.Output>
      </div>
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb aria-valuetext={label} />
      </Slider.Track>
    </Slider>
    </div>
  );
}
