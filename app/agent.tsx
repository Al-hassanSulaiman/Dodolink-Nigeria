import React, { useCallback, useState, useEffect } from 'react';
import { StyleSheet, View, Text, ScrollView, Platform, Pressable, TextInput, ActivityIndicator, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useListProducts, getListProductsQueryKey } from '@workspace/api-client-react';
import { ProductCard } from '@/components/ProductCard';
import { StoreCard } from '@/components/StoreCard';
import { Feather } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import {
  clearStoredPurchasePlan,
  createPurchasePlan,
  getStoredPurchasePlan,
  publishPurchasePlan,
  type PurchasePlan,
  WEBMCP_PLAN_EVENT,
  WEBMCP_STATUS_EVENT,
} from '@/webmcp/marketplace';

const DEMO_PROMPTS = [
  "Find me a reliable smartphone under ₦200,000",
  "I need a bulk supplier of organic honey",
  "Show me local fashion brands with good reviews"
];

export default function AgentRoute() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  
  const isDesktop = width >= 900;
  const isTabletOrDesktop = width >= 600;

  const [query, setQuery] = useState("");
  const [activePrompt, setActivePrompt] = useState("");
  const [agentStatus, setAgentStatus] = useState<'connecting' | 'ready' | 'unavailable'>('connecting');
  const [plan, setPlan] = useState<PurchasePlan | null>(() => getStoredPurchasePlan());
  const [isSearching, setIsSearching] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof window === 'undefined') return;

    const updateStatus = (status?: string) => {
      const current = status ?? document.documentElement.dataset.webmcpStatus;
      setAgentStatus(current === 'active' ? 'ready' : current === 'unavailable' || current === 'error' ? 'unavailable' : 'connecting');
    };
    const onStatus = (event: Event) => updateStatus((event as CustomEvent<string>).detail);
    updateStatus();
    window.addEventListener(WEBMCP_STATUS_EVENT, onStatus);
    return () => window.removeEventListener(WEBMCP_STATUS_EVENT, onStatus);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const onPlan = (event: Event) => {
      const nextPlan = (event as CustomEvent<PurchasePlan>).detail;
      if (!nextPlan) return;
      setQuery(nextPlan.query);
      setActivePrompt(nextPlan.query);
      setPlan(nextPlan);
      setPlanError(null);
      setIsSearching(false);
    };
    window.addEventListener(WEBMCP_PLAN_EVENT, onPlan);
    return () => window.removeEventListener(WEBMCP_PLAN_EVENT, onPlan);
  }, []);

  const handlePlanRequest = useCallback(async (request: string) => {
    const trimmed = request.trim();
    if (trimmed.length <= 2) return;

    setActivePrompt(trimmed);
    setIsSearching(true);
    setPlanError(null);
    try {
      const nextPlan = await createPurchasePlan({ query: trimmed, limit: 4 });
      setPlan(nextPlan);
      publishPurchasePlan(nextPlan);
    } catch (error) {
      setPlan(null);
      setPlanError(error instanceof Error ? error.message : 'The marketplace could not be searched right now.');
    } finally {
      setIsSearching(false);
    }
  }, []);

  const { data: popularProducts, isLoading: isLoadingPopular } = useListProducts(
    { limit: 4 },
    { 
      query: { 
        enabled: activePrompt.length <= 2,
        queryKey: getListProductsQueryKey({ limit: 4 })
      } 
    }
  );
  const demoPrompts = [
    ...(popularProducts ?? []).slice(0, 1).map(
      (product) =>
        `Find ${product.name} under ₦${Math.ceil(product.price * 1.1).toLocaleString('en-NG')}`,
    ),
    ...DEMO_PROMPTS,
  ].slice(0, 3);

  if (Platform.OS !== 'web') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.mobileFallback, { backgroundColor: colors.background }]}>
          <View style={[styles.mobileFallbackContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.iconWrapper, { backgroundColor: colors.secondary }]}>
              <Feather name="monitor" size={32} color={colors.primary} />
            </View>
            <Text style={[styles.mobileFallbackTitle, { color: colors.foreground }]}>Desktop Experience</Text>
            <Text style={[styles.mobileFallbackDesc, { color: colors.mutedForeground }]}>
              The DodoLink WebMCP Agent is a robust collaboration environment optimized for desktop browsers. Please visit this URL on your computer to continue.
            </Text>
            <Pressable 
              style={[styles.backBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.push('/')}
            >
              <Text style={[styles.backBtnText, { color: colors.primaryForeground }]}>Return to Home</Text>
            </Pressable>
          </View>
        </View>
      </>
    );
  }

  const renderPurchasePlan = () => {
    if (isSearching) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Agent is analyzing marketplace data...</Text>
        </View>
      );
    }

    if (planError) {
      return (
        <View style={[styles.emptyBox, { borderColor: colors.destructive }]}>
          <Feather name="alert-circle" size={32} color={colors.destructive} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{planError}</Text>
          <Pressable
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
            onPress={() => void handlePlanRequest(activePrompt)}
          >
            <Text style={[styles.retryBtnText, { color: colors.primaryForeground }]}>Try again</Text>
          </Pressable>
        </View>
      );
    }

    if (plan) {
      const products = plan.products.slice(0, 4);
      const stores = plan.stores.slice(0, 2);

      return (
        <View style={styles.planContainer}>
          <View style={styles.planHeader}>
            <View style={styles.planHeaderLeft}>
              <View style={[styles.planIcon, { backgroundColor: colors.primary }]}>
                <Feather name="check" size={16} color={colors.primaryForeground} />
              </View>
              <Text style={[styles.planTitle, { color: colors.foreground }]}>Proposed Purchase Plan</Text>
            </View>
            <Pressable onPress={() => { setQuery(''); setActivePrompt(''); setPlan(null); setPlanError(null); clearStoredPurchasePlan(); }} style={styles.clearBtn}>
              <Text style={[styles.clearBtnText, { color: colors.mutedForeground }]}>Clear</Text>
            </Pressable>
          </View>

          <View style={[styles.summaryBox, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
            <Text style={[styles.summaryText, { color: colors.secondaryForeground }]}>
              {plan.explanation}
            </Text>
          </View>

          {stores.length > 0 && (
            <View style={styles.planSection}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recommended Suppliers</Text>
              {stores.map(store => (
                <StoreCard key={store.id} store={store} />
              ))}
            </View>
          )}

          {products.length > 0 && (
            <View style={styles.planSection}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Product Shortlist</Text>
              <View style={styles.grid}>
                {products.map(product => (
                  <View key={product.id} style={[styles.gridItem, isTabletOrDesktop && styles.gridItemTablet]}>
                    <ProductCard product={product} />
                  </View>
                ))}
              </View>
            </View>
          )}

          {products.length === 0 && stores.length === 0 && (
            <View style={[styles.emptyBox, { borderColor: colors.border }]}>
              <Feather name="inbox" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No direct matches found. Try adjusting your parameters or checking different keywords.</Text>
            </View>
          )}

          {(products.length > 0 || stores.length > 0) && (
            <View style={[styles.handoffBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <View style={styles.handoffHeader}>
                <Feather name="shield" size={20} color={colors.accent} />
                <Text style={[styles.handoffTitle, { color: colors.foreground }]}>Human Approval Required</Text>
              </View>
              <Text style={[styles.handoffDesc, { color: colors.mutedForeground }]}>
                {plan.humanNextStep}
              </Text>
            </View>
          )}
        </View>
      );
    }

    return (
      <View style={styles.defaultContainer}>
        <View style={styles.defaultHeader}>
          <Feather name="trending-up" size={20} color={colors.foreground} />
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Marketplace Highlights</Text>
        </View>
        <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
          While you prepare your prompt, here are some active listings across the market.
        </Text>
        
        {isLoadingPopular ? (
          <View style={styles.loadingContainerSmall}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : popularProducts && popularProducts.length > 0 ? (
          <View style={styles.grid}>
            {popularProducts.map(product => (
              <View key={product.id} style={[styles.gridItem, isTabletOrDesktop && styles.gridItemTablet]}>
                <ProductCard product={product} />
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView 
        style={[styles.container, { backgroundColor: colors.background }]} 
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top, paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
      <View style={[styles.hero, { backgroundColor: colors.primary }]}>
        <View style={styles.heroInner}>
          <Pressable onPress={() => router.push('/')} style={styles.navBack}>
            <Feather name="arrow-left" size={20} color="#fff" />
            <Text style={styles.navBackText}>Back to Market</Text>
          </Pressable>
          <View style={styles.heroContent}>
            <View style={styles.badge}>
              <Feather name="activity" size={14} color="#fff" />
              <Text style={styles.badgeText}>
                {agentStatus === 'ready' ? 'WebMCP Protocol: Active' : 
                 agentStatus === 'connecting' ? 'WebMCP Protocol: Connecting...' : 
                 'WebMCP Protocol: Unavailable'}
              </Text>
            </View>
            <Text style={styles.heroTitle}>DodoLink Co-Pilot</Text>
            <Text style={styles.heroSubtitle}>
              Collaborate with your local market agent to source, compare, and verify products before you make a decision.
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.contentWrapper}>
        <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
          
          {/* Agent Console / Sidebar */}
          <View style={[styles.sidebar, isDesktop && styles.sidebarDesktop]}>
            <View style={[styles.agentInterface, { backgroundColor: colors.card, borderColor: colors.border, shadowColor: colors.foreground }]}>
              <View style={[styles.agentHeader, { borderBottomColor: colors.border }]}>
                <View style={styles.agentHeaderLeft}>
                  <Feather name="cpu" size={20} color={colors.primary} />
                  <Text style={[styles.agentTitle, { color: colors.foreground }]}>Agent Console</Text>
                </View>
                <View style={[styles.statusDot, { backgroundColor: agentStatus === 'ready' ? '#4ADE80' : '#F59E0B' }]} />
              </View>
              
              <View style={styles.agentBody}>
                <Text style={[styles.instruction, { color: colors.mutedForeground }]}>
                  Describe what you're looking for. The agent will analyze the marketplace, check vendor credibility, and build a curated purchase plan.
                </Text>

                <View style={styles.demoPrompts}>
                  {demoPrompts.map((demo, idx) => (
                    <Pressable 
                      key={idx} 
                      style={[
                        styles.demoPromptBtn, 
                        { backgroundColor: colors.background, borderColor: colors.border }
                      ]}
                      onPress={() => {
                        setQuery(demo);
                         void handlePlanRequest(demo);
                      }}
                    >
                      <Feather name="arrow-right" size={14} color={colors.primary} style={styles.demoIcon} />
                      <Text style={[styles.demoPromptText, { color: colors.foreground }]}>{demo}</Text>
                    </Pressable>
                  ))}
                </View>

                <View style={[
                  styles.inputWrapper, 
                  { 
                    borderColor: activePrompt === query && query.length > 2 ? colors.primary : colors.border, 
                    backgroundColor: colors.background 
                  }
                ]}>
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    placeholder="E.g., Find me wholesale organic honey in Lagos..."
                    placeholderTextColor={colors.mutedForeground}
                    value={query}
                    onChangeText={setQuery}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                    onSubmitEditing={() => {
                      if (query.trim().length > 2) {
                         void handlePlanRequest(query);
                      }
                    }}
                  />
                  <Pressable 
                    style={[
                      styles.submitBtn, 
                      { backgroundColor: query.trim().length > 2 ? colors.primary : colors.muted }
                    ]}
                    disabled={query.trim().length <= 2}
                     onPress={() => void handlePlanRequest(query)}
                  >
                    <Feather 
                      name="send" 
                      size={16} 
                      color={query.trim().length > 2 ? colors.primaryForeground : colors.mutedForeground} 
                    />
                    <Text style={[
                      styles.submitBtnText, 
                      { color: query.trim().length > 2 ? colors.primaryForeground : colors.mutedForeground }
                    ]}>
                      Send to Agent
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>

          {/* Main Content / Plan */}
          <View style={[styles.mainContent, isDesktop && styles.mainContentDesktop]}>
            {renderPurchasePlan()}
          </View>

        </View>
      </View>
    </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  mobileFallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  mobileFallbackContent: {
    width: '100%',
    maxWidth: 400,
    padding: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  iconWrapper: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  mobileFallbackTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    marginBottom: 12,
    textAlign: 'center',
  },
  mobileFallbackDesc: {
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  backBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  backBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  
  hero: {
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  heroInner: {
    maxWidth: 1200,
    width: '100%',
    marginHorizontal: 'auto',
  },
  navBack: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 32,
    alignSelf: 'flex-start',
  },
  navBackText: {
    color: '#fff',
    fontFamily: 'Inter_500Medium',
    marginLeft: 8,
    fontSize: 14,
  },
  heroContent: {
    maxWidth: 600,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  badgeText: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    marginLeft: 6,
  },
  heroTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 40,
    color: '#fff',
    marginBottom: 16,
    lineHeight: 48,
  },
  heroSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: 28,
  },
  
  contentWrapper: {
    paddingHorizontal: 24,
    paddingTop: 40,
    flex: 1,
  },
  layout: {
    maxWidth: 1200,
    width: '100%',
    marginHorizontal: 'auto',
    flexDirection: 'column',
    gap: 32,
  },
  layoutDesktop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  sidebar: {
    width: '100%',
  },
  sidebarDesktop: {
    width: 380,
    flexShrink: 0,
  },
  mainContent: {
    flex: 1,
    width: '100%',
  },
  mainContentDesktop: {
    minWidth: 0, 
  },
  
  agentInterface: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  agentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  agentHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  agentTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  agentBody: {
    padding: 20,
  },
  instruction: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 20,
  },
  demoPrompts: {
    gap: 8,
    marginBottom: 24,
  },
  demoPromptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  demoIcon: {
    marginRight: 8,
  },
  demoPromptText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    flex: 1,
  },
  inputWrapper: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  input: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    padding: 16,
    minHeight: 100,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    margin: 8,
    borderRadius: 8,
    gap: 8,
  },
  submitBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  
  loadingContainer: {
    padding: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingContainerSmall: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    marginTop: 16,
  },
  
  planContainer: {
    flex: 1,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  planHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  planIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  clearBtnText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  summaryBox: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 32,
  },
  summaryText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 24,
  },
  
  planSection: {
    marginBottom: 32,
  },
  defaultContainer: {
    flex: 1,
  },
  defaultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 20,
    marginBottom: 16,
  },
  sectionSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    marginBottom: 24,
  },
  
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -8,
  },
  gridItem: {
    width: '100%',
    paddingHorizontal: 8,
  },
  gridItemTablet: {
    width: '50%',
  },
  
  emptyBox: {
    padding: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 12,
  },
  emptyText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 16,
    maxWidth: 300,
    lineHeight: 22,
  },
  retryBtn: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  
  handoffBox: {
    marginTop: 16,
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
  },
  handoffHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  handoffTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
  },
  handoffDesc: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 24,
  },
});
