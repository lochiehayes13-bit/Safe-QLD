import React, { useCallback, useRef, useState } from 'react';
import { formatAuDate } from '@/export/sheets';
import { Pressable, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getAssetByCode, findBySerial, type AssetRecord } from '@/db/assetRepo';
import { queryCatalogue, type CatalogueItem } from '@/db/catalogueRepo';
import { assetTypeById } from '@/seed/assetTypes';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, Field, Rowed, Screen, Txt } from '@/components/ui';

/**
 * Scanning a tag to find what it is attached to.
 *
 * A technician standing in front of a device wants its history, and typing a
 * fifteen-character asset code on a ladder is how that does not happen. The
 * scanner takes whatever the tag encodes and tries, in order: our own asset
 * code, a serial number, then the parts catalogue — because the label on a new
 * device is the manufacturer's barcode, not ours, and finding the part is still
 * more useful than finding nothing.
 *
 * There is a manual entry field underneath, permanently. Scanning fails for
 * ordinary reasons — a faded label, a tag behind a pipe, no camera permission —
 * and a scanner with no fallback is a dead end at exactly the wrong moment.
 */
type Found =
  | { kind: 'asset'; asset: AssetRecord }
  | { kind: 'part'; part: CatalogueItem }
  | { kind: 'none'; code: string };

export default function ScanScreen() {
  const t = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [found, setFound] = useState<Found | null>(null);
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  // The camera fires this continuously while a code is in frame; without a
  // guard one tag becomes dozens of lookups and a jittering screen.
  const lastCode = useRef<string | null>(null);

  const lookup = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    setBusy(true);
    try {
      const asset = await getAssetByCode(code);
      if (asset) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setFound({ kind: 'asset', asset });
        return;
      }

      const bySerial = await findBySerial(code);
      if (bySerial.length === 1) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setFound({ kind: 'asset', asset: bySerial[0]! });
        return;
      }

      const parts = await queryCatalogue({ search: code, limit: 2 });
      // Only when it is unambiguous. Two candidates means we have not
      // identified anything, and saying so is more use than picking one.
      const exact = parts.filter((p) => p.partNumber.toUpperCase() === code.toUpperCase());
      if (exact.length === 1) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setFound({ kind: 'part', part: exact[0]! });
        return;
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setFound({ kind: 'none', code });
    } finally {
      setBusy(false);
    }
  }, []);

  const onScanned = useCallback(
    ({ data }: { data: string }) => {
      if (!data || data === lastCode.current) return;
      lastCode.current = data;
      void lookup(data);
    },
    [lookup],
  );

  const reset = () => {
    lastCode.current = null;
    setFound(null);
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Scan' }} />
      <Screen>
        {permission?.granted ? (
          <View
            style={{
              height: 300, borderRadius: t.radius.md, overflow: 'hidden',
              borderWidth: 1, borderColor: t.color.border, backgroundColor: '#000',
            }}
          >
            <CameraView
              style={{ flex: 1 }}
              barcodeScannerSettings={{
                barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'datamatrix', 'pdf417'],
              }}
              onBarcodeScanned={found ? undefined : onScanned}
            />
          </View>
        ) : (
          <Card>
            <Txt weight="700">Camera not available</Txt>
            <Txt size="sm" tone="muted" style={{ lineHeight: 19, marginTop: 4 }}>
              {permission?.canAskAgain === false
                ? 'Camera access was turned off for this app. Turn it back on in the phone’s settings, or type the code below.'
                : 'Scanning needs access to the camera. You can also type the code below.'}
            </Txt>
            {permission?.canAskAgain !== false ? (
              <Button title="Allow camera" variant="secondary" onPress={() => void requestPermission()} style={{ marginTop: t.space(2.5) }} />
            ) : null}
          </Card>
        )}

        {found ? <Result found={found} onAgain={reset} /> : (
          <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
            Point the camera at an asset tag, a device label or a part barcode.
          </Txt>
        )}

        <Card>
          <Field
            label="Or type the code"
            value={manual}
            onChangeText={setManual}
            autoCapitalize="characters"
            placeholder="Asset code, serial or part number"
          />
          <Button
            title="Look it up"
            variant="secondary"
            loading={busy}
            onPress={() => {
              lastCode.current = null;
              void lookup(manual);
            }}
            style={{ marginTop: t.space(2) }}
          />
        </Card>
      </Screen>
    </>
  );
}

function Result({ found, onAgain }: { found: Found; onAgain: () => void }) {
  const t = useTheme();

  if (found.kind === 'asset') {
    const a = found.asset;
    const type = assetTypeById(a.assetTypeId);
    return (
      <Card onPress={() => router.push({ pathname: '/assets/[id]', params: { id: a.id } })}>
        <Rowed align="flex-start" gap={2}>
          <MaterialCommunityIcons name="cube-outline" size={22} color={t.color.pass} />
          <View style={{ flex: 1 }}>
            <Txt weight="700">{a.name || type?.label || 'Asset'}</Txt>
            <Txt size="sm" tone="muted">
              {[type?.label, a.code, [a.level, a.room].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
            </Txt>
            <Rowed gap={2} wrap style={{ marginTop: t.space(1.5) }}>
              {a.lastResult ? <Chip label={a.lastResult === 'fail' ? 'Last failed' : 'Last passed'} tone={a.lastResult === 'fail' ? 'fail' : 'pass'} /> : null}
              {a.lastServicedAt ? <Chip label={`Serviced ${formatAuDate(a.lastServicedAt)}`} /> : null}
            </Rowed>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={t.color.textFaint} />
        </Rowed>
      </Card>
    );
  }

  if (found.kind === 'part') {
    const p = found.part;
    return (
      <Card>
        <Rowed align="flex-start" gap={2}>
          <MaterialCommunityIcons name="tag-outline" size={22} color={t.color.accent} />
          <View style={{ flex: 1 }}>
            <Txt weight="700">{p.partNumber}</Txt>
            <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{p.name}</Txt>
            <Rowed gap={2} wrap style={{ marginTop: t.space(1.5) }}>
              <Chip label={p.brand} />
              {p.supplier ? <Chip label={p.supplier} /> : null}
            </Rowed>
            <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 17 }}>
              This is a catalogue part, not an asset on a site. Nothing here is a record of this particular device.
            </Txt>
          </View>
        </Rowed>
        <Pressable onPress={onAgain} style={{ marginTop: t.space(2.5) }}>
          <Txt size="sm" tone="accent">Scan another</Txt>
        </Pressable>
      </Card>
    );
  }

  return (
    <>
      <Banner
        tone="warn"
        title="Nothing matched that code"
        body={`Read as "${found.code}". It is not an asset code, a serial we hold, or a part number in the catalogue. If this device should be on the register, add it and give it a tag.`}
      />
      <Rowed gap={2}>
        <Button title="Scan another" variant="secondary" onPress={onAgain} style={{ flex: 1 }} />
        <Button
          title="Search parts"
          variant="secondary"
          onPress={() => router.push({ pathname: '/catalogue', params: { q: found.code } })}
          style={{ flex: 1 }}
        />
      </Rowed>
    </>
  );
}
