import { Button } from "@heroui/react";
import { useEffect, useState } from "react";

export function InstallButton() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() =>
    window.matchMedia("(display-mode: standalone)").matches,
  );

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;
  if (prompt) {
    return (
      <Button
        size="sm"
        variant="secondary"
        onPress={() => {
          void prompt.prompt();
        }}
      >
        Install
      </Button>
    );
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (ios) return <p className="text-xs text-stone-500">Share, then Add to Home Screen.</p>;
  return null;
}
