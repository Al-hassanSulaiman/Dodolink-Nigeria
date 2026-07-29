export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 px-8 py-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-[#1B5E20] flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Terms of Service</h1>
            <p className="text-sm text-gray-500 mt-0.5">Dodolink NG · Last updated July 29, 2026</p>
          </div>
        </div>

        <div className="prose prose-gray max-w-none text-sm leading-relaxed space-y-6">

          <section>
            <p className="text-gray-700">
              These Terms of Service ("Terms") govern your access to and use of the Dodolink NG mobile
              application and related services (collectively, the "App") operated by Dodolink NG
              ("Dodolink", "we", "us", or "our"). By creating an account or using the App you agree to
              be bound by these Terms. If you do not agree, you must not use the App.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">1. Eligibility &amp; Account Registration</h2>
            <p className="text-gray-700">
              You must be at least 18 years old and capable of forming a legally binding contract to use
              the App. By registering, you confirm that all information you provide is accurate, current,
              and complete, and that you will keep it up to date. You are responsible for maintaining the
              confidentiality of your account credentials and for all activity that occurs under your account.
              Notify us immediately at{" "}
              <a href="mailto:support@dodolink.com.ng" className="text-[#1B5E20] underline">
                support@dodolink.com.ng
              </a>{" "}
              if you suspect unauthorised access.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">2. Acceptable Use</h2>
            <p className="text-gray-700 mb-2">
              You agree to use the App only for lawful purposes and in a manner consistent with these
              Terms. You must not:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-gray-700">
              <li>List, sell, or promote illegal, counterfeit, or prohibited goods or services.</li>
              <li>Engage in fraudulent transactions, price manipulation, or false advertising.</li>
              <li>Harass, threaten, defame, or impersonate any person or entity.</li>
              <li>Interfere with or disrupt the App's infrastructure, servers, or networks.</li>
              <li>Attempt to gain unauthorised access to any part of the App or its systems.</li>
              <li>Use automated bots, scrapers, or scripts to access the App without prior written consent.</li>
              <li>Post or transmit content that is obscene, offensive, or infringes the rights of others.</li>
              <li>Violate any applicable law, regulation, or third-party right.</li>
            </ul>
            <p className="text-gray-700 mt-2">
              We reserve the right to investigate suspected violations and take any action we deem
              appropriate, including removing content or suspending accounts.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">3. Seller Responsibilities</h2>
            <p className="text-gray-700 mb-2">
              If you operate a store on Dodolink NG ("Seller"), you are solely responsible for:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-gray-700">
              <li>
                <span className="font-medium">Accurate listings</span> — ensuring that all product
                descriptions, prices, photos, and availability information are truthful and not
                misleading.
              </li>
              <li>
                <span className="font-medium">Fulfilment</span> — delivering goods or services to buyers
                as described and within the timeframe communicated to the buyer.
              </li>
              <li>
                <span className="font-medium">Legal compliance</span> — obtaining all necessary permits,
                licences, and regulatory approvals required to sell your products or services in Nigeria.
              </li>
              <li>
                <span className="font-medium">Taxes</span> — understanding and meeting all applicable tax
                obligations arising from your sales.
              </li>
              <li>
                <span className="font-medium">Customer disputes</span> — handling buyer complaints
                promptly and in good faith. Dodolink may mediate disputes at its discretion but is not
                obligated to do so.
              </li>
            </ul>
            <p className="text-gray-700 mt-2">
              Dodolink is a marketplace platform and is not a party to any transaction between buyers and
              sellers. We do not guarantee the quality, safety, or legality of items listed on the App.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">4. Payments</h2>
            <p className="text-gray-700">
              Payment processing is provided by Paystack (paystack.com) and is subject to Paystack's own
              Terms of Service. By making or receiving payments through the App you also agree to
              Paystack's terms. Dodolink is not responsible for errors, delays, or failures caused by
              Paystack or any payment network. All fees payable to Dodolink (if any) will be disclosed
              to you before you incur them.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">5. Intellectual Property</h2>
            <p className="text-gray-700">
              The App and all its content — including the Dodolink name, logo, software, design, and
              text — are owned by or licensed to Dodolink and are protected by copyright, trademark, and
              other intellectual property laws. You may not reproduce, distribute, or create derivative
              works from our content without our prior written permission.
            </p>
            <p className="text-gray-700 mt-2">
              By posting content on the App (such as product photos or store descriptions) you grant
              Dodolink a non-exclusive, worldwide, royalty-free licence to use, display, and distribute
              that content solely to operate and promote the App.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">6. Account Termination</h2>
            <p className="text-gray-700">
              You may close your account at any time from the App settings. Upon closure, your store
              listings and public profile will be removed from the App. Data retention after closure is
              governed by our{" "}
              <a href="/admin/privacy" className="text-[#1B5E20] underline">
                Privacy Policy
              </a>
              .
            </p>
            <p className="text-gray-700 mt-2">
              We may suspend or permanently terminate your account — with or without notice — if we
              determine that you have violated these Terms, engaged in fraudulent activity, or posed a
              risk to other users or to Dodolink. Termination does not waive any rights or remedies we
              may have under applicable law.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">7. Disclaimer of Warranties</h2>
            <p className="text-gray-700">
              The App is provided on an <span className="font-medium">"as is" and "as available"</span>{" "}
              basis without warranties of any kind, either express or implied, including but not limited
              to warranties of merchantability, fitness for a particular purpose, or non-infringement.
              We do not warrant that the App will be uninterrupted, error-free, or free of viruses or
              other harmful components. Your use of the App is at your sole risk.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">8. Limitation of Liability</h2>
            <p className="text-gray-700">
              To the fullest extent permitted by Nigerian law, Dodolink and its officers, directors,
              employees, and agents shall not be liable for any indirect, incidental, special,
              consequential, or punitive damages — including loss of profits, data, goodwill, or business
              opportunities — arising out of or related to your use of the App, even if we have been
              advised of the possibility of such damages.
            </p>
            <p className="text-gray-700 mt-2">
              In no event shall our total aggregate liability to you for all claims arising from or
              related to these Terms or the App exceed the greater of (a) the amounts you paid to
              Dodolink in the twelve months preceding the claim, or (b) ₦10,000.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">9. Indemnification</h2>
            <p className="text-gray-700">
              You agree to indemnify and hold harmless Dodolink and its officers, directors, employees,
              and agents from and against any claims, liabilities, damages, losses, and expenses
              (including reasonable legal fees) arising out of or in any way connected with your access
              to or use of the App, your violation of these Terms, or your infringement of any
              third-party rights.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">10. Governing Law &amp; Dispute Resolution</h2>
            <p className="text-gray-700">
              These Terms are governed by the laws of the Federal Republic of Nigeria. Any dispute
              arising out of or relating to these Terms or the App shall first be subject to good-faith
              negotiation between the parties. If unresolved within 30 days, disputes shall be submitted
              to the exclusive jurisdiction of the courts of Lagos State, Nigeria. Nothing in this
              clause prevents either party from seeking urgent injunctive relief from a court of
              competent jurisdiction.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">11. Changes to These Terms</h2>
            <p className="text-gray-700">
              We may update these Terms from time to time. When we do, we will update the "Last updated"
              date at the top of this page. For material changes, we will notify you via the App or by
              email at least 7 days before the changes take effect. Continued use of the App after the
              effective date constitutes your acceptance of the revised Terms. If you do not agree to the
              revised Terms, you must stop using the App and may close your account.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">12. Contact Us</h2>
            <p className="text-gray-700">
              Questions about these Terms? Reach us at:
            </p>
            <div className="mt-2 p-4 bg-gray-50 rounded-xl text-gray-700 text-sm">
              <p className="font-medium">Dodolink NG</p>
              <p>
                Email:{" "}
                <a href="mailto:support@dodolink.com.ng" className="text-[#1B5E20] underline">
                  support@dodolink.com.ng
                </a>
              </p>
              <p>
                Website:{" "}
                <a
                  href="https://dodolink.com.ng"
                  className="text-[#1B5E20] underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  dodolink.com.ng
                </a>
              </p>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
