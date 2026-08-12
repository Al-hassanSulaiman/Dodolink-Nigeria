import { useState } from 'react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { 
  Carousel, 
  CarouselContent, 
  CarouselItem, 
} from '@/components/ui/carousel';
import { 
  Menu, X, ExternalLink, Mail, Download, Send, Loader2,
  Smartphone, ShoppingBag, Store, Tag, 
  MessageSquare, Star, LayoutDashboard, CheckCircle2
} from 'lucide-react';

const assets = {
  headshot: '/portfolio/assets/headshot.jpeg',
  video: '/portfolio/assets/demo.mp4',
  cv: '/portfolio/assets/cv.pdf',
  screenshots: [
    { src: '/portfolio/assets/screenshot-1.jpeg', alt: 'DodoLink Sign-up', type: 'mobile' },
    { src: '/portfolio/assets/screenshot-2.jpeg', alt: 'Marketplace Feed', type: 'mobile' },
    { src: '/portfolio/assets/screenshot-3.jpeg', alt: 'Create Store', type: 'mobile' },
    { src: '/portfolio/assets/screenshot-4.jpeg', alt: 'Store Dashboard', type: 'mobile' },
    { src: '/portfolio/assets/screenshot-5.jpeg', alt: 'In-app Chat', type: 'mobile' },
    { src: '/portfolio/assets/screenshot-6.jpeg', alt: 'Reviews & Ratings', type: 'mobile' },
    { src: '/portfolio/assets/screenshot-7.png', alt: 'Admin Dashboard', type: 'desktop' },
    { src: '/portfolio/assets/screenshot-8.png', alt: 'Store Verification', type: 'desktop' },
  ]
};

const features = [
  { icon: <Smartphone className="h-5 w-5" />, title: 'Sign-up', desc: 'Seamless email-based account creation' },
  { icon: <ShoppingBag className="h-5 w-5" />, title: 'Marketplace', desc: 'Browse products and discover local businesses' },
  { icon: <Store className="h-5 w-5" />, title: 'Business Stores', desc: 'Create and manage digital storefronts' },
  { icon: <Tag className="h-5 w-5" />, title: 'Product Listings', desc: 'Rich product display with names, prices, and images' },
  { icon: <MessageSquare className="h-5 w-5" />, title: 'Chat', desc: 'Real-time buyer-seller messaging built in' },
  { icon: <Star className="h-5 w-5" />, title: 'Reviews & Ratings', desc: 'Verified store reviews to build trust' },
  { icon: <LayoutDashboard className="h-5 w-5" />, title: 'Admin Dashboard', desc: 'Comprehensive platform overview and management' },
  { icon: <CheckCircle2 className="h-5 w-5" />, title: 'Store Verification', desc: 'Admin review workflow for store applications' },
];

const skills = [
  'React Native', 'Expo', 'TypeScript', 'Node.js', 'Express', 
  'PostgreSQL', 'REST APIs', 'AI-Assisted Development', 
  'Admin Dashboards', 'Paystack Integration'
];

const BUDGET_OPTIONS = [
  'Under $500',
  '$500 – $1,000',
  '$1,000 – $3,000',
  '$3,000 – $10,000',
  '$10,000+',
  "Let's discuss",
];

export default function Home() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const { toast } = useToast();

  // Contact form state
  const [contactForm, setContactForm] = useState({ name: '', email: '', description: '', budget: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactForm.name || !contactForm.email || !contactForm.description || !contactForm.budget) {
      toast({ title: 'Please fill in all fields.', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const apiBase = window.location.origin;
      const res = await fetch(`${apiBase}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contactForm),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Something went wrong');
      }
      setSubmitted(true);
      setContactForm({ name: '', email: '', description: '', budget: '' });
    } catch (err) {
      toast({
        title: 'Failed to send message',
        description: err instanceof Error ? err.message : 'Please try again later.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const scrollTo = (id: string) => {
    setMobileMenuOpen(false);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const fadeInUp: Variants = {
    hidden: { opacity: 0, y: 40 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } }
  };

  const stagger: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden selection:bg-primary selection:text-primary-foreground">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-6 h-20 flex items-center justify-between">
          <div className="font-display font-bold text-xl tracking-tight cursor-pointer" onClick={() => scrollTo('hero')}>
            ALHASSAN<span className="text-primary">.</span>
          </div>
          
          <div className="hidden md:flex gap-8 text-sm font-medium">
            <button onClick={() => scrollTo('about')} className="hover:text-primary transition-colors">About</button>
            <button onClick={() => scrollTo('work')} className="hover:text-primary transition-colors">Work</button>
            <button onClick={() => scrollTo('skills')} className="hover:text-primary transition-colors">Skills</button>
            <button onClick={() => scrollTo('contact')} className="hover:text-primary transition-colors">Contact</button>
          </div>

          <div className="hidden md:block">
            <Button onClick={() => scrollTo('contact')} className="rounded-full px-6 font-semibold">
              Hire Me
            </Button>
          </div>

          <button className="md:hidden text-foreground p-2 -mr-2" onClick={() => setMobileMenuOpen(true)}>
            <Menu className="h-6 w-6" />
          </button>
        </div>
      </nav>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed inset-0 z-[60] bg-background/95 backdrop-blur-xl flex flex-col items-center justify-center gap-8"
          >
            <button className="absolute top-6 right-6 p-2 text-foreground" onClick={() => setMobileMenuOpen(false)}>
              <X className="h-8 w-8" />
            </button>
            <button onClick={() => scrollTo('about')} className="text-2xl font-display font-bold">About</button>
            <button onClick={() => scrollTo('work')} className="text-2xl font-display font-bold">Work</button>
            <button onClick={() => scrollTo('skills')} className="text-2xl font-display font-bold">Skills</button>
            <button onClick={() => scrollTo('contact')} className="text-2xl font-display font-bold">Contact</button>
            <Button size="lg" onClick={() => scrollTo('contact')} className="rounded-full mt-4">
              Hire Me
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="pt-20">
        {/* Hero Section */}
        <section id="hero" className="min-h-[90vh] flex items-center py-20 relative overflow-hidden">
          {/* Decorative background blur */}
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/20 rounded-full blur-[120px] pointer-events-none" />

          <div className="container mx-auto px-6 grid lg:grid-cols-2 gap-12 lg:gap-8 items-center relative z-10">
            <motion.div 
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={stagger}
              className="order-2 lg:order-1 flex flex-col items-start gap-6"
            >
              <motion.div variants={fadeInUp} className="inline-block px-4 py-1.5 rounded-full bg-secondary/50 border border-border text-sm font-medium tracking-wide">
                Available for new projects
              </motion.div>
              <motion.h1 variants={fadeInUp} className="text-5xl md:text-7xl lg:text-8xl font-display font-bold leading-[1.1] tracking-tight">
                SHIP <br/><span className="text-primary">FASTER.</span>
              </motion.h1>
              <motion.p variants={fadeInUp} className="text-xl md:text-2xl text-muted-foreground max-w-lg leading-relaxed">
                I'm <strong className="text-foreground font-semibold">Alhassan Sulaiman</strong>, a Full-Stack MVP Developer. I build production-ready apps at startup speed using AI assistance.
              </motion.p>
              <motion.div variants={fadeInUp} className="flex flex-wrap gap-4 pt-4">
                <Button size="lg" className="rounded-full h-14 px-8 text-base font-semibold" onClick={() => scrollTo('contact')}>
                  Hire Me <Mail className="ml-2 h-5 w-5" />
                </Button>
                <Button size="lg" variant="outline" className="rounded-full h-14 px-8 text-base font-semibold border-2" onClick={() => scrollTo('work')}>
                  See My Work
                </Button>
              </motion.div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="order-1 lg:order-2 flex justify-center lg:justify-end"
            >
              <div className="relative w-64 h-64 md:w-80 md:h-80 lg:w-[400px] lg:h-[400px]">
                <div className="absolute inset-0 rounded-full border-2 border-primary/20 scale-105" />
                <div className="absolute inset-0 rounded-full border-2 border-primary/40 scale-110" />
                <img 
                  src={assets.headshot} 
                  alt="Alhassan Sulaiman" 
                  className="w-full h-full object-cover rounded-full shadow-2xl relative z-10 filter contrast-105" style={{ objectPosition: '50% 0%' }}
                />
              </div>
            </motion.div>
          </div>
        </section>

        {/* About Section */}
        <section id="about" className="py-24 bg-secondary/30 border-y border-border/50">
          <div className="container mx-auto px-6">
            <motion.div 
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-100px" }}
              variants={fadeInUp}
              className="max-w-3xl mx-auto text-center"
            >
              <h2 className="text-3xl md:text-4xl font-display font-bold mb-8">Not just demos. <span className="text-primary">Real products.</span></h2>
              <p className="text-lg md:text-xl text-muted-foreground leading-relaxed">
                I build production-ready MVPs fast — mobile apps, web platforms, and admin dashboards — using AI-assisted development to compress months of work into weeks. I handle the full stack end-to-end: design, frontend, backend, database, and deployment.
              </p>
            </motion.div>
          </div>
        </section>

        {/* Work / Case Study Section */}
        <section id="work" className="py-32">
          <div className="container mx-auto px-6">
            <motion.div 
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeInUp}
              className="mb-16 md:flex justify-between items-end gap-6"
            >
              <div>
                <h2 className="text-4xl md:text-6xl font-display font-bold mb-4 tracking-tight">Flagship MVP</h2>
                <div className="flex items-center gap-4">
                  <h3 className="text-2xl font-semibold">DodoLink NG</h3>
                  <a href="https://dodolink.com.ng" target="_blank" rel="noreferrer" className="inline-flex items-center px-3 py-1 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors rounded-full text-sm font-medium border border-primary/20">
                    dodolink.com.ng <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                </div>
                <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
                  A comprehensive Nigerian marketplace platform connecting customers with businesses. Built completely solo from zero to production.
                </p>
              </div>
            </motion.div>

            {/* Video Demo */}
            <motion.div 
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeInUp}
              className="mb-24 rounded-2xl overflow-hidden border border-border shadow-2xl bg-card"
            >
              <div className="p-4 border-b border-border bg-secondary/50 flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-destructive/60" />
                <div className="w-3 h-3 rounded-full bg-amber-500/60" />
                <div className="w-3 h-3 rounded-full bg-primary/60" />
                <span className="ml-4 text-sm font-medium text-muted-foreground font-mono">Platform Demo</span>
              </div>
              <video 
                src={assets.video} 
                controls 
                preload="metadata"
                className="w-full max-h-[70vh] object-contain bg-black"
              />
            </motion.div>

            {/* Features Grid */}
            <div className="mb-24">
              <h4 className="text-2xl font-display font-bold mb-8">Core Features</h4>
              <motion.div 
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={stagger}
                className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6"
              >
                {features.map((feature, idx) => (
                  <motion.div key={idx} variants={fadeInUp}>
                    <Card className="h-full bg-card hover:border-primary/50 transition-colors">
                      <CardContent className="p-6 flex flex-col gap-4">
                        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                          {feature.icon}
                        </div>
                        <div>
                          <h5 className="font-bold text-lg mb-1">{feature.title}</h5>
                          <p className="text-sm text-muted-foreground">{feature.desc}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </motion.div>
            </div>

            {/* Screenshots Gallery */}
            <div>
              <h4 className="text-2xl font-display font-bold mb-8">Platform Walkthrough</h4>
              
              {/* Mobile Swipeable Gallery */}
              <div className="lg:hidden mb-12 relative px-4">
                <Carousel
                  opts={{
                    align: "center",
                  }}
                  className="w-full"
                >
                  <CarouselContent>
                    {assets.screenshots.filter(s => s.type === 'mobile').map((shot, idx) => (
                      <CarouselItem key={idx} className="basis-4/5 sm:basis-1/2">
                        <motion.div 
                          initial="hidden"
                          whileInView="visible"
                          viewport={{ once: true }}
                          variants={fadeInUp}
                          className="cursor-pointer group h-full"
                          onClick={() => setLightboxImg(shot.src)}
                        >
                          <div className="rounded-2xl overflow-hidden border border-border bg-card shadow-lg h-full flex flex-col">
                            <div className="aspect-[9/19] relative w-full">
                              <img src={shot.src} alt={shot.alt} className="absolute inset-0 w-full h-full object-cover" />
                            </div>
                            <div className="p-4 bg-card border-t border-border mt-auto">
                              <p className="font-medium text-sm text-center">{shot.alt}</p>
                            </div>
                          </div>
                        </motion.div>
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                </Carousel>
              </div>

              {/* Desktop view of Mobile Screenshots */}
              <div className="hidden lg:grid lg:grid-cols-4 lg:gap-8 mb-12">
                {assets.screenshots.filter(s => s.type === 'mobile').map((shot, idx) => (
                  <motion.div 
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    variants={fadeInUp}
                    key={idx} 
                    className="cursor-pointer group"
                    onClick={() => setLightboxImg(shot.src)}
                  >
                    <div className="rounded-2xl overflow-hidden border border-border bg-card shadow-lg transition-transform group-hover:-translate-y-2 h-full flex flex-col">
                      <div className="aspect-[9/19] relative w-full">
                        <img src={shot.src} alt={shot.alt} className="absolute inset-0 w-full h-full object-cover" />
                      </div>
                      <div className="p-4 bg-card border-t border-border mt-auto">
                        <p className="font-medium text-sm text-center">{shot.alt}</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Desktop Screenshots */}
              <div className="grid md:grid-cols-2 gap-8 mt-8">
                {assets.screenshots.filter(s => s.type === 'desktop').map((shot, idx) => (
                  <motion.div 
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    variants={fadeInUp}
                    key={idx} 
                    className="cursor-pointer group"
                    onClick={() => setLightboxImg(shot.src)}
                  >
                    <div className="rounded-2xl overflow-hidden border border-border bg-card shadow-lg transition-transform group-hover:-translate-y-2">
                      <div className="aspect-video relative bg-black/5">
                        <img src={shot.src} alt={shot.alt} className="absolute inset-0 w-full h-full object-cover object-top" />
                      </div>
                      <div className="p-4 bg-card border-t border-border">
                        <p className="font-medium text-center">{shot.alt}</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Skills Section */}
        <section id="skills" className="py-24 bg-primary text-primary-foreground">
          <div className="container mx-auto px-6 text-center">
            <motion.h2 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-3xl md:text-5xl font-display font-bold mb-12"
            >
              The Stack
            </motion.h2>
            <motion.div 
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={stagger}
              className="flex flex-wrap justify-center gap-4 max-w-4xl mx-auto"
            >
              {skills.map((skill, idx) => (
                <motion.div key={idx} variants={fadeInUp}>
                  <Badge variant="outline" className="px-6 py-3 text-lg rounded-full border-2 border-primary-foreground/30 bg-primary-foreground/10 backdrop-blur-sm hover:bg-primary-foreground hover:text-primary transition-colors cursor-default">
                    {skill}
                  </Badge>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Contact Form */}
        <section id="contact" className="py-32">
          <div className="container mx-auto px-6">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeInUp}
              className="max-w-2xl mx-auto"
            >
              <div className="text-center mb-12">
                <h2 className="text-4xl md:text-6xl font-display font-bold mb-6 tracking-tight">Ready to build your MVP?</h2>
                <p className="text-xl text-muted-foreground max-w-xl mx-auto">
                  Stop waiting for the perfect moment. Tell me about your project and let's get it in front of users this month.
                </p>
              </div>

              {submitted ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="rounded-2xl border border-border bg-card p-12 text-center flex flex-col items-center gap-4"
                >
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                    <CheckCircle2 className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-2xl font-display font-bold">Message sent!</h3>
                  <p className="text-muted-foreground max-w-sm">
                    Thanks for reaching out. I'll get back to you within 24 hours.
                  </p>
                  <Button variant="outline" className="rounded-full mt-4" onClick={() => setSubmitted(false)}>
                    Send another message
                  </Button>
                </motion.div>
              ) : (
                <form onSubmit={handleContactSubmit} className="rounded-2xl border border-border bg-card p-8 md:p-10 flex flex-col gap-6">
                  <div className="grid sm:grid-cols-2 gap-6">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="contact-name">Name</Label>
                      <Input
                        id="contact-name"
                        placeholder="Your name"
                        value={contactForm.name}
                        onChange={e => setContactForm(f => ({ ...f, name: e.target.value }))}
                        required
                        disabled={submitting}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="contact-email">Email</Label>
                      <Input
                        id="contact-email"
                        type="email"
                        placeholder="you@example.com"
                        value={contactForm.email}
                        onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))}
                        required
                        disabled={submitting}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="contact-description">Project description</Label>
                    <Textarea
                      id="contact-description"
                      placeholder="Tell me about your idea — what it does, who it's for, and what you need built."
                      rows={5}
                      value={contactForm.description}
                      onChange={e => setContactForm(f => ({ ...f, description: e.target.value }))}
                      required
                      disabled={submitting}
                      className="resize-none"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="contact-budget">Budget range</Label>
                    <Select
                      value={contactForm.budget}
                      onValueChange={val => setContactForm(f => ({ ...f, budget: val }))}
                      disabled={submitting}
                    >
                      <SelectTrigger id="contact-budget">
                        <SelectValue placeholder="Select a budget range" />
                      </SelectTrigger>
                      <SelectContent>
                        {BUDGET_OPTIONS.map(opt => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-4 pt-2">
                    <Button
                      type="submit"
                      size="lg"
                      className="rounded-full h-14 px-10 text-base font-bold w-full sm:w-auto"
                      disabled={submitting}
                    >
                      {submitting ? (
                        <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Sending…</>
                      ) : (
                        <><Send className="mr-2 h-5 w-5" /> Send Message</>
                      )}
                    </Button>
                    <Button size="lg" variant="secondary" className="rounded-full h-14 px-10 text-base font-bold border border-border w-full sm:w-auto" asChild>
                      <a href={assets.cv} download>
                        Download CV <Download className="ml-2 h-5 w-5" />
                      </a>
                    </Button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-8 border-t border-border bg-card">
        <div className="container mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="font-display font-bold text-lg">ALHASSAN<span className="text-primary">.</span></div>
          <div className="text-muted-foreground text-sm">
            © {new Date().getFullYear()} Alhassan Sulaiman. All rights reserved.
          </div>
          <div className="text-sm font-medium text-foreground">
            alhassansulaiman1369@gmail.com
          </div>
        </div>
      </footer>

      {/* Lightbox Modal */}
      <AnimatePresence>
        {lightboxImg && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4 md:p-12 cursor-zoom-out backdrop-blur-sm"
            onClick={() => setLightboxImg(null)}
          >
            <button 
              className="absolute top-6 right-6 p-2 text-white/70 hover:text-white bg-black/50 rounded-full transition-colors"
              onClick={(e) => { e.stopPropagation(); setLightboxImg(null); }}
            >
              <X className="h-8 w-8" />
            </button>
            <motion.img 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              src={lightboxImg} 
              alt="Expanded view" 
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
