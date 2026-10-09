import React, { useCallback, useRef, useState } from 'react';
import { formatAuDate } from '@/export/sheets';
import { Pressable, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  findAssetsByIdentifier, findBySerialContaining, type AssetIdentifierHit,
} from '@/db/assetRepo';
import { findByPartNumber, type CatalogueItem } from '@/db/catalogueRepo';
import { officeNumber, resolveScan, type ScanResult } from '@/domain/assetLookup';
import { assetTypeById } from '@/seed/assetTypes';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, Field, Rowed, Screen, Txt } from '@/components/ui';
import { showAlert } from '@/components/alert';

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
type Found = ScanResult<AssetIdentifierHit, CatalogueItem>;

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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
    if (!raw.trim()) return;
    setBusy(true);
    try {
      // The printed label carries the tag without hyphens, and a Simpro
      // asset is known by the office's own number: both are read here.
      const result = await resolveScan(raw, {
        byIdentifier: (keys) => findAssetsByIdentifier(keys),
        bySerialContaining: (read) => findBySerialContaining(read),
        parts: (read) => findByPartNumber(read),
      });
      if (!result) return;
      void Haptics.notificationAsync(
        result.kind === 'none'
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Success,
      );
      setFound(result);
    } catch (e) {
      showAlert('Lookup failed', errorText(e));
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
            <Txt weight="700">Camera off</Txt>
            <Txt size="sm" tone="muted" style={{ lineHeight: 19, marginTop: 4 }}>
              {permission?.canAskAgain === false
                ? 'Allow the camera in Settings, or type the code below.'
                : 'Allow the camera to scan, or type the code below.'}
            </Txt>
            {permission?.canAskAgain !== false ? (
              <Button
                title="Allow camera"
                variant="secondary"
                // A refusal comes back as a resolved permission that is still
                // not granted, so without this the button is pressed, nothing
                // moves, and there is nothing on screen to explain it. The same
                // is true in a browser, which has no camera to grant.
                onPress={() => {
                  void requestPermission()
                    .then((next) => {
                      if (next.granted) return;
                      showAlert(
                        'Still no camera',
                        next.canAskAgain
                          ? 'Type the code below instead.'
                          : 'Allow the camera in Settings, or type the code below.',
                      );
                    })
                    .catch((e: unknown) => showAlert('Camera unavailable', `${errorText(e)} Type the code below.`));
                }}
                style={{ marginTop: t.space(2.5) }}
              />
            ) : null}
          </Card>
        )}

        {found ? <Result found={found} onAgain={reset} /> : (
          <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
            Point at the tag, label or barcode.
          </Txt>
        )}

        <Card>
          <Field
            label="Or type the code"
            value={manual}
            onChangeText={setManual}
            autoCapitalize="characters"
            placeholder="Tag, asset #, serial or part"
          />
          <Button
            title="Look it up"
            variant="secondary"
            loading={busy}
            // Off until there is something to look up. It used to be pressable
            // with the box empty, and `lookup` returned on the empty string
            // without a word — the one button on a screen whose camera has
            // already failed, doing nothing.
            disabled={!manual.trim()}
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

function AssetCard({ asset }: { asset: AssetIdentifierHit }) {
  const t = useTheme();
  const type = assetTypeById(asset.assetTypeId);
  const officeNo = officeNumber(asset.attributes);
  return (
    <Card onPress={() => router.push({ pathname: '/assets/[id]', params: { id: asset.id } })}>
      <Rowed align="flex-start" gap={2}>
        <MaterialCommunityIcons name="cube-outline" size={22} color={t.color.pass} />
        <View style={{ flex: 1 }}>
          <Txt weight="700">{asset.name || type?.label || 'Asset'}</Txt>
          <Txt size="sm" numberOfLines={1}>{asset.siteName ?? 'No site'}</Txt>
          <Txt size="sm" tone="muted">
            {[
              type?.label,
              asset.code,
              officeNo && officeNo !== asset.code ? `Asset # ${officeNo}` : undefined,
              [asset.level, asset.room].filter(Boolean).join(' '),
            ].filter(Boolean).join(' · ')}
          </Txt>
          <Rowed gap={2} wrap style={{ marginTop: t.space(1.5) }}>
            {asset.lastResult === 'pass' || asset.lastResult === 'fail' ? (
              <Chip
                label={asset.lastResult === 'fail' ? 'Last failed' : 'Last passed'}
                tone={asset.lastResult === 'fail' ? 'fail' : 'pass'}
              />
            ) : null}
            {asset.lastServicedAt ? <Chip label={`Serviced ${formatAuDate(asset.lastServicedAt)}`} /> : null}
          </Rowed>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color={t.color.textFaint} />
      </Rowed>
    </Card>
  );
}

function Result({ found, onAgain }: { found: Found; onAgain: () => void }) {
  const t = useTheme();
  const again = <Button title="Scan another" variant="secondary" onPress={onAgain} />;

  if (found.kind === 'asset') {
    return (
      <>
        <AssetCard asset={found.asset} />
        {again}
      </>
    );
  }

  if (found.kind === 'assets') {
    return (
      <>
        <Txt size="sm" tone="muted">{found.assets.length} assets match “{found.read}”. Pick the right site.</Txt>
        {found.assets.map((a) => <AssetCard key={a.id} asset={a} />)}
        {again}
      </>
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
              Catalogue part, not a site asset.
            </Txt>
          </View>
        </Rowed>
        <Pressable onPress={onAgain} style={{ marginTop: t.space(2.5) }}>
          <Txt size="sm" tone="accent">Scan another</Txt>
        </Pressable>
      </Card>
    );
  }

  const banner = found.problem === 'misread'
    ? { title: 'Tag misread', body: `Read “${found.read}”. Scan it again or type it.` }
    : found.problem === 'newer-label'
      ? { title: 'Newer label', body: 'Update the app to read this label.' }
      : { title: 'No match', body: `No asset or part matches “${found.read}”.` };

  return (
    <>
      <Banner tone="warn" title={banner.title} body={banner.body} />
      <Rowed gap={2}>
        <Button title="Scan another" variant="secondary" onPress={onAgain} style={{ flex: 1 }} />
        <Button
          title="Search parts"
          variant="secondary"
          onPress={() => router.push({ pathname: '/office-catalogue', params: { q: found.read } })}
          style={{ flex: 1 }}
        />
      </Rowed>
    </>
  );
}
