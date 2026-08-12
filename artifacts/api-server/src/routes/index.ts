import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storesRouter from "./stores";
import productsRouter from "./products";
import searchRouter from "./search";
import messagesRouter from "./messages";
import reviewsRouter from "./reviews";
import pushTokensRouter from "./push_tokens";
import storageRouter from "./storage";
import supportRouter from "./support";
import adminRouter from "./admin";
import subscriptionsRouter from "./subscriptions";
import webhooksRouter from "./webhooks";
import contactRouter from "./contact";

const router: IRouter = Router();

router.use(healthRouter);
router.use(contactRouter);
router.use(adminRouter);
router.use(storesRouter);
router.use(productsRouter);
router.use(searchRouter);
router.use(messagesRouter);
router.use(reviewsRouter);
router.use(pushTokensRouter);
router.use(storageRouter);
router.use(supportRouter);
router.use(subscriptionsRouter);
router.use(webhooksRouter);

export default router;
