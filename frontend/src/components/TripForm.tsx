import {
  Button,
  ComboBox,
  DateField,
  Description,
  Input,
  Label,
  ListBox,
  NumberField,
  Tabs,
  TimeField,
} from "@heroui/react";
import { CalendarDate, Time } from "@internationalized/date";
import { useEffect, useState } from "react";

import { geocode } from "../api";
import type { Place } from "../types";

export interface TripValues {
  origin: Place | null;
  destination: Place | null;
  date: CalendarDate;
  time: Time;
  loadLb: number;
  sampleMiles: 10 | 25 | 50;
}

export function initialTrip(): TripValues {
  const next = new Date();
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return {
    origin: null,
    destination: null,
    date: new CalendarDate(next.getFullYear(), next.getMonth() + 1, next.getDate()),
    time: new Time(next.getHours(), 0),
    loadLb: 35000,
    sampleMiles: 25,
  };
}

export function departureStamp(values: TripValues): string {
  const month = String(values.date.month).padStart(2, "0");
  const day = String(values.date.day).padStart(2, "0");
  const hour = String(values.time.hour).padStart(2, "0");
  const minute = String(values.time.minute).padStart(2, "0");
  return `${values.date.year}-${month}-${day}T${hour}:${minute}`;
}

export function TripForm({
  busy,
  initial,
  onSubmit,
}: {
  busy: boolean;
  initial?: TripValues;
  onSubmit: (values: TripValues) => void;
}) {
  const [values, setValues] = useState(() => initial ?? initialTrip());
  const [error, setError] = useState("");

  function submit() {
    if (!values.origin || !values.destination) {
      setError("Pick an origin and a destination from the list.");
      return;
    }
    if (!(values.loadLb > 0) || values.loadLb > 200000) {
      setError("Load weight must be greater than 0 and at most 200,000 lb.");
      return;
    }
    setError("");
    onSubmit(values);
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <PlaceField
        label="Origin"
        place={values.origin}
        onPlace={(origin) => setValues((current) => ({ ...current, origin }))}
      />
      <PlaceField
        label="Destination"
        place={values.destination}
        onPlace={(destination) => setValues((current) => ({ ...current, destination }))}
      />
      <div className="grid grid-cols-2 gap-3">
        <DateField
          granularity="day"
          value={values.date}
          onChange={(date) => {
            if (date) setValues((current) => ({ ...current, date: date as CalendarDate }));
          }}
        >
          <Label>Departure date</Label>
          <DateField.Group fullWidth>
            <DateField.Input>{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
          </DateField.Group>
        </DateField>
        <TimeField
          hourCycle={24}
          value={values.time}
          onChange={(time) => {
            if (time) setValues((current) => ({ ...current, time: time as Time }));
          }}
        >
          <Label>Departure time</Label>
          <TimeField.Group fullWidth>
            <TimeField.Input>{(segment) => <TimeField.Segment segment={segment} />}</TimeField.Input>
          </TimeField.Group>
        </TimeField>
      </div>
      <Description>Local time where you start.</Description>
      <NumberField
        fullWidth
        maxValue={200000}
        minValue={1}
        value={values.loadLb}
        onChange={(loadLb) => {
          if (Number.isFinite(loadLb)) setValues((current) => ({ ...current, loadLb }));
        }}
      >
        <Label>Load weight (lb)</Label>
        <NumberField.Group>
          <NumberField.Input />
        </NumberField.Group>
        <Description>30,000 lb and 40,000 lb do not trigger the load rules. The next pound does.</Description>
      </NumberField>
      <div className="flex flex-wrap gap-2">
        {[20000, 35000, 45000].map((pounds) => (
          <Button
            key={pounds}
            className="h-11 min-h-11"
            size="sm"
            variant={values.loadLb === pounds ? "primary" : "secondary"}
            onPress={() => setValues((current) => ({ ...current, loadLb: pounds }))}
          >
            {pounds.toLocaleString()} lb
          </Button>
        ))}
      </div>
      <Tabs
        selectedKey={String(values.sampleMiles)}
        onSelectionChange={(key) =>
          setValues((current) => ({ ...current, sampleMiles: Number(key) as 10 | 25 | 50 }))
        }
      >
        <Label>Sample every</Label>
        <Tabs.ListContainer>
          <Tabs.List aria-label="Sample interval">
            <Tabs.Tab id="10" className="min-h-11">
              10 mi
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="25" className="min-h-11">
              25 mi
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="50" className="min-h-11">
              50 mi
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
      {error && (
        <p className="text-sm text-red-700" id="trip-error" role="alert">
          {error}
        </p>
      )}
      </div>
      <Button className="mt-3 h-11 min-h-11 shrink-0" fullWidth isDisabled={busy} type="button" variant="primary" onPress={submit}>
        {busy ? "Checking routes…" : "Compare routes"}
      </Button>
    </form>
  );
}

function PlaceField({
  label,
  place,
  onPlace,
}: {
  label: string;
  place: Place | null;
  onPlace: (place: Place | null) => void;
}) {
  const [text, setText] = useState(place?.label ?? "");
  const [items, setItems] = useState<Place[]>(place ? [place] : []);

  useEffect(() => {
    if (place && text === place.label) return;
    if (text.trim().length < 2) {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      geocode(text.trim(), controller.signal)
        .then(setItems)
        .catch((error: unknown) => {
          if ((error as { name?: string }).name === "AbortError") return;
          setItems([]);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [text, place]);

  return (
    <ComboBox
      allowsEmptyCollection
      inputValue={text}
      items={items}
      menuTrigger="input"
      selectedKey={place?.id ?? null}
      onInputChange={(value) => {
        setText(value);
        if (place && value !== place.label) onPlace(null);
      }}
      onSelectionChange={(key) => {
        const next = items.find((item) => item.id === key) ?? null;
        onPlace(next);
        if (next) setText(next.label);
      }}
    >
      <Label>{label}</Label>
      <ComboBox.InputGroup>
        <Input placeholder="City or place" aria-describedby="trip-error" />
        <ComboBox.Trigger />
      </ComboBox.InputGroup>
      <ComboBox.Popover>
        <ListBox
          items={items}
          renderEmptyState={() => <div className="px-3 py-2 text-sm">No matches</div>}
        >
          {(item) => (
            <ListBox.Item id={item.id} textValue={item.label}>
              {item.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          )}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  );
}
