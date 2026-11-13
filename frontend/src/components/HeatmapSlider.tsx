import { Label, Slider } from "@heroui/react";
import { useLayoutEffect, useRef } from "react";

export function HeatmapSlider({
  hour,
  label,
  caption,
  onHour,
}: {
  hour: number;
  label: string;
  caption?: string;
  onHour: (hour: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    rootRef.current
      ?.querySelector<HTMLInputElement>("input[type='range']")
      ?.setAttribute("aria-valuetext", label);
  }, [label, hour]);
  return (
    <div ref={rootRef} className="rounded-full bg-white/90 px-3 py-1.5 shadow">
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
          <Label className="sr-only">Forecast hour</Label>
          <Slider.Output className="text-left text-xs font-medium text-[#1C1917]">{label}</Slider.Output>
        </div>
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb aria-valuetext={label} />
        </Slider.Track>
      </Slider>
      {caption && <p className="mt-0.5 text-[10px] leading-tight text-stone-500">{caption}</p>}
    </div>
  );
}
