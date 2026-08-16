export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-full bg-[#1B5E20] flex items-center justify-center">
              <span className="text-white font-bold text-lg">D</span>
            </div>
            <span className="font-bold text-xl text-[#1B5E20]">Dodolink NG</span>
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Privacy Policy</h1>
          <p className="text-gray-500">Last updated: August 2026</p>
        </div>

        <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">
          <section>
            <p>
              Dodolink NG ("we", "us", or "our") operates the Dodolink NG mobile application. This Privacy Policy explains how we collect, use, and protect your information when you use our app.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Information We Collect</h2>
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Information you provide</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>Account details: name, email address, and password when you create an account</li>
              <li>Store information: store name, location, phone number, CAC registration number, and description</li>
              <li>Product listings: photos, descriptions, prices, and categories</li>
              <li>Messages sent through the in-app chat</li>
              <li>Reviews and ratings you submit</li>
            </ul>

            <h3 className="text-lg font-semibold text-gray-800 mb-2 mt-6">Information collected automatically</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>Device type and operating system version</li>
              <li>Push notification tokens for order and message alerts</li>
              <li>Location data (only when you grant permission) to display nearby stores</li>
              <li>Photos accessed from your library (only when you choose to upload a product image)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">How We Use Your Information</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>To create and manage your account</li>
              <li>To display your store and products to potential buyers</li>
              <li>To facilitate messaging between buyers and sellers</li>
              <li>To send push notifications for new messages and activity</li>
              <li>To process seller subscriptions and payments</li>
              <li>To show nearby stores based on your location (when permitted)</li>
              <li>To improve the app and resolve issues</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">How We Share Your Information</h2>
            <p>We do not sell your personal information. We share it only in these cases:</p>
            <ul className="list-disc pl-6 space-y-2 mt-3">
              <li><strong>With other users:</strong> Your store name, location, product listings, and ratings are visible to all app users. Messages are visible only to the conversation participants.</li>
              <li><strong>With service providers:</strong> We use third-party services for authentication (Clerk), payment processing (Paystack), push notifications (Expo), and cloud storage. These providers process data only as needed to deliver the service.</li>
              <li><strong>For legal reasons:</strong> We may disclose information if required by law or to protect the rights and safety of our users.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Data Retention</h2>
            <p>
              We keep your account data for as long as your account is active. If you delete your account, we remove your personal information within 30 days, except where retention is required by law. Product listings and store information are deleted with your account. Messages may be retained for a short period for dispute resolution purposes.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Your Rights</h2>
            <p>You can:</p>
            <ul className="list-disc pl-6 space-y-2 mt-3">
              <li>Access, update, or correct your account information at any time from within the app</li>
              <li>Delete your account and associated data by contacting us</li>
              <li>Revoke location or photo access at any time through your device settings</li>
              <li>Opt out of push notifications through your device settings</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Children's Privacy</h2>
            <p>
              Dodolink NG is not directed at children under 13. We do not knowingly collect personal information from children under 13. If you believe a child has provided us with personal information, please contact us and we will delete it.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Security</h2>
            <p>
              We use industry-standard security practices including encrypted connections (HTTPS/TLS), secure authentication tokens, and access controls to protect your data. No method of transmission over the internet is 100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of significant changes by updating the date at the top of this page. Continued use of the app after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Contact Us</h2>
            <p>
              If you have questions about this Privacy Policy or want to exercise your data rights, contact us at:
            </p>
            <div className="mt-4 p-6 bg-gray-50 rounded-xl">
              <p className="font-semibold text-gray-900">Dodolink NG</p>
              <p className="text-gray-600 mt-1">Email: <a href="mailto:support@dodolink.com.ng" className="text-[#1B5E20] font-medium">support@dodolink.com.ng</a></p>
              <p className="text-gray-600">Website: <a href="https://dodolink.com.ng" className="text-[#1B5E20] font-medium">dodolink.com.ng</a></p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
