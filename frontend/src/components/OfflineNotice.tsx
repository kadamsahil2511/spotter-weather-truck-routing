import { Alert } from "@heroui/react";

export function OfflineNotice() {
  return (
    <Alert className="mb-3" status="warning">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Offline</Alert.Title>
        <Alert.Description>Offline. Showing the last trip.</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}
