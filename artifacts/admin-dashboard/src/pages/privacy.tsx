export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 px-8 py-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-[#1B5E20] flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Privacy Policy</h1>
            <p className="text-sm text-gray-500 mt-0.5">Dodolink NG · Last updated July 29, 2026</p>
          </div>
        </div>

        <div className="prose prose-gray max-w-none text-sm leading-relaxed space-y-6">

          <section>
            <p className="text-gray-700">
              Dodolink NG ("Dodolink", "we", "us", or "our") operates the Dodolink NG mobile application
              (the "App"). This Privacy Policy explains what information we collect when you use our App,
              how we use it, and the choices you have. By using the App, you agree to the practices described here.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">1. Information We Collect</h2>
            <div className="space-y-3 text-gray-700">
              <div>
                <p className="font-medium text-gray-800">Account Information</p>
                <p>When you create an account we collect your email address and, if you choose to provide it, your name and profile photo. This information is used to identify you, secure your account, and communicate with you about activity on your account.</p>
              </div>
              <div>
                <p className="font-medium text-gray-800">Location Data</p>
                <p>With your permission, the App collects your precise device location while the App is in use. Location data is used to show you nearby stores and help customers discover your store. We do not collect location data in the background or when the App is closed. You may revoke location permission at any time in your device settings.</p>
              </div>
              <div>
                <p className="font-medium text-gray-800">Messages</p>
                <p>When you exchange messages with other users (e.g. buyers contacting a seller), the content of those messages is stored on our servers so that both parties can read the conversation. We do not sell message content to third parties.</p>
              </div>
              <div>
                <p className="font-medium text-gray-800">Payment Information</p>
                <p>Payments within the App are processed by Paystack (paystack.com). We do not store your card number, bank account details, or other sensitive payment credentials on our servers. Paystack collects and processes payment details under their own Privacy Policy, which you can read at <a href="https://paystack.com/privacy" className="text-[#1B5E20] underline" target="_blank" rel="noopener noreferrer">paystack.com/privacy</a>. We receive a transaction confirmation and reference number so we can fulfil your order.</p>
              </div>
              <div>
                <p className="font-medium text-gray-800">Device &amp; Usage Information</p>
                <p>We automatically collect certain technical information such as your device model, operating system version, app version, and anonymous usage events (e.g. screens visited). This helps us diagnose bugs and improve the App.</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">2. Push Notifications</h2>
            <p className="text-gray-700">
              With your permission, we send push notifications to inform you about new orders, incoming messages, and important account activity. You can disable push notifications at any time in your device settings or within the App. Disabling notifications does not affect your ability to use the App.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">3. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-1 text-gray-700">
              <li>To create and manage your account</li>
              <li>To facilitate transactions between buyers and sellers</li>
              <li>To deliver messages between users</li>
              <li>To show location-relevant content such as nearby stores</li>
              <li>To send transactional and service notifications</li>
              <li>To detect and prevent fraud or abuse</li>
              <li>To improve the performance and reliability of the App</li>
              <li>To comply with our legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">4. Sharing Your Information</h2>
            <p className="text-gray-700">
              We do not sell your personal information. We may share information with:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-gray-700 mt-2">
              <li><span className="font-medium">Paystack</span> — to process payments on your behalf.</li>
              <li><span className="font-medium">Cloud infrastructure providers</span> — we store data on secure cloud servers. These providers act as data processors and are contractually required to keep your data confidential.</li>
              <li><span className="font-medium">Law enforcement or regulators</span> — when required by applicable law, court order, or to protect the safety of our users.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">5. Data Retention</h2>
            <p className="text-gray-700">
              We retain your account data and messages for as long as your account is active. If you delete your account, we will delete your personal information within 90 days, except where we are required to retain it for legal or compliance purposes (e.g. transaction records). Anonymised, aggregated data that cannot identify you may be retained indefinitely.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">6. Your Rights &amp; Choices</h2>
            <ul className="list-disc pl-5 space-y-1 text-gray-700">
              <li><span className="font-medium">Access &amp; correction</span> — you may view and update your profile information within the App at any time.</li>
              <li><span className="font-medium">Account deletion</span> — you may delete your account from the App settings. This will remove your personal data subject to the retention exceptions above.</li>
              <li><span className="font-medium">Location</span> — you may revoke location permission in your device settings.</li>
              <li><span className="font-medium">Notifications</span> — you may opt out of push notifications in your device settings or the App.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">7. Security</h2>
            <p className="text-gray-700">
              We use industry-standard security measures including encrypted data transmission (HTTPS/TLS), access controls, and regular security reviews. No method of transmission or storage is 100% secure, but we take reasonable precautions to protect your information.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">8. Children's Privacy</h2>
            <p className="text-gray-700">
              Dodolink NG is not directed to children under the age of 13. We do not knowingly collect personal information from children. If you believe a child has provided us with personal information, please contact us and we will delete it promptly.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">9. Changes to This Policy</h2>
            <p className="text-gray-700">
              We may update this Privacy Policy from time to time. When we do, we will update the "Last updated" date at the top of this page. For material changes, we will notify you via the App or by email. Continued use of the App after changes take effect constitutes your acceptance of the revised policy.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">10. Contact Us</h2>
            <p className="text-gray-700">
              If you have questions or concerns about this Privacy Policy or how we handle your data, you can reach us directly through the in-app support feature:
            </p>
            <div className="mt-2 p-4 bg-gray-50 rounded-xl text-gray-700 text-sm">
              <p className="font-medium">Dodolink NG</p>
              <p>
                In-app support: open the App, go to <span className="font-medium">Settings → Support</span>, and send us a message — we'll reply as soon as possible.
              </p>
              <p className="mt-1">
                Website:{" "}
                <a href="https://dodolink.com.ng" className="text-[#1B5E20] underline" target="_blank" rel="noopener noreferrer">
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
