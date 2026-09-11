import React, { useCallback, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getVendor, searchVendorOrders, type VendorOrderRecord, type VendorRecord } from '@/db/moreRepo';
import { contactActions, formatAddress, mapHref } from '@/domain/jobPresentation';
import { describeLoadFailure } from '@/domain/loadFailure';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import { Banner, Button, Card, Chip, Label, Rowed, Screen, SectionHeader, StatusPill, Txt } from '@/components/ui';
import { RecordGate } from '@/components/RecordGate';

/**
 * A supplier, as the office holds them.
 *
 * Who to ring when the part has not turned up, where their counter is, and
 * the orders the company has open with them. The id is Simpro's own
 * supplier number, which is what a purchase order carries, so this is one
 * tap from any order.
 *
 * No prices, no terms, no account numbers: none of that was mirrored.
 */
export default function VendorScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [vendor, setVendor] = useState<VendorRecord | null>(null);
  // Loaded-and-absent is not the same as still loading. See RecordGate.
  const [missing, setMissing] = useState(false);
  // And a read that threw is neither. See RecordGate.
  const [failed, setFailed] = useState<string | null>(null);
  const [orders, setOrders] = useState<VendorOrderRecord[]>([]);
  const [reloads, setReloads] = useState(0);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void (async () => {
      if (!id) return;
      setFailed(null);
      try {
        const v = await getVendor(id);
        if (cancelled) return;
        setVendor(v);
        setMissing(!v);
        if (!v) return;
        const recent = await searchVendorOrders('', { vendorExternalId: id, limit: 8 });
        if (!cancelled) setOrders(recent);
      } catch (e) {
        if (!cancelled) setFailed(describeLoadFailure(e, 'this supplier'));
      }
    })();
    return () => { cancelled = true; };
  }, [id, reloads]));

  if (!vendor) {
    return (
      <RecordGate
        missing={missing}
        what="supplier"
        why="Suppliers come down with a sync once Simpro is connected. This one is not on the phone yet, or the office has removed it."
        failed={failed}
        onRetry={() => setReloads((n) => n + 1)}
      />
    );
  }

  const v = vendor;
  const address = formatAddress(v.address);
  const map = mapHref(address);
  const ways = contactActions({ workPhone: v.phone, email: v.email });
  const website = v.website?.trim();

  return (
    <>
      <Stack.Screen options={{ title: v.name }} />
      <Screen>
        <Txt size="xl" weight="700">{v.name}</Txt>
        <Rowed gap={1.5} wrap>
          <Chip label="Supplier" />
          <Chip label={`#${v.id}`} />
        </Rowed>
        {v.archived ? (
          <Banner tone="warn" title="Archived in Simpro" body="The office has filed this supplier away. Check before ordering from them." />
        ) : null}

        <Card>
          <Label>Reach them</Label>
          <View style={{ marginTop: t.space(2), gap: t.space(2) }}>
            {ways.length ? (
              <Rowed gap={2} wrap>
                {ways.map((w) => (
                  <Button
                    key={w.href}
                    title={w.label}
                    variant="secondary"
                    compact
                    icon={<MaterialCommunityIcons name={w.kind === 'email' ? 'email-outline' : 'phone-outline'} size={18} color={t.color.text} />}
                    onPress={() => void Linking.openURL(w.href)}
                  />
                ))}
              </Rowed>
            ) : null}
            {website ? (
              <ActionRow
                icon="web"
                label={website}
                onPress={() => void Linking.openURL(/^https?:\/\//i.test(website) ? website : `https://${website}`)}
              />
            ) : null}
            {address ? <ActionRow icon="map-marker-outline" label={address} onPress={map ? () => void Linking.openURL(map) : undefined} /> : null}
            {!ways.length && !website && !address ? (
              <Txt size="sm" tone="faint">The office has no phone, email or address for them.</Txt>
            ) : null}
          </View>
        </Card>

        <SectionHeader
          title="Orders with them"
          action={orders.length ? 'All' : undefined}
          onAction={() => router.push({ pathname: '/orders', params: { vendorExternalId: v.id, vendorName: v.name } })}
        />
        {orders.length ? (
          orders.map((o) => (
            <Card key={o.id} onPress={() => router.push({ pathname: '/orders/[id]', params: { id: o.id } })}>
              <Rowed align="flex-start" gap={3}>
                <View style={{ flex: 1 }}>
                  <Txt weight="700">PO {o.id}{o.jobId ? ` · Job ${o.jobId}` : ''}</Txt>
                  {o.reference ? <Txt size="sm" tone="muted" numberOfLines={1}>{o.reference}</Txt> : null}
                  <Txt size="xs" tone="faint">
                    {[o.dateIssued ? `Issued ${formatAuDate(o.dateIssued)}` : undefined, o.dueDate ? `Due ${formatAuDate(o.dueDate)}` : undefined].filter(Boolean).join(' · ')}
                  </Txt>
                </View>
                <StatusPill label={o.statusName ?? o.stage ?? 'Order'} tone={o.archived ? 'muted' : 'info'} />
              </Rowed>
            </Card>
          ))
        ) : (
          <Txt size="sm" tone="faint">No purchase orders to this supplier are on the phone.</Txt>
        )}

        <Txt size="xs" tone="faint" style={{ marginTop: t.space(2) }}>
          Simpro supplier {v.id}.{v.dateModified ? ` Last changed at the office ${formatAuDate(v.dateModified)}.` : ''}
        </Txt>
      </Screen>
    </>
  );
}

function ActionRow({
  icon, label, onPress,
}: { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; onPress?: () => void }) {
  const t = useTheme();
  const body = (
    <Rowed gap={3} style={{ minHeight: onPress ? 44 : undefined }}>
      <MaterialCommunityIcons name={icon} size={20} color={onPress ? t.color.accentText : t.color.textFaint} />
      <Txt size="sm" weight={onPress ? '700' : '500'} tone={onPress ? 'accent' : 'default'} style={{ flex: 1 }}>{label}</Txt>
      {onPress ? <MaterialCommunityIcons name="open-in-new" size={16} color={t.color.textFaint} /> : null}
    </Rowed>
  );
  if (!onPress) return body;
  return <Pressable onPress={onPress} hitSlop={4}>{body}</Pressable>;
}
