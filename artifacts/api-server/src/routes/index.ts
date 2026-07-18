import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storesRouter from "./stores";
import productsRouter from "./products";
import searchRouter from "./search";
import messagesRouter from "./messages";
import reviewsRouter from "./reviews";
import pushTokensRouter from "./push_tokens";
import storageRouter from "./storage";
import adminRouter from "./admin";
import subscriptionsRouter from "./subscriptions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adminRouter);
router.use(storesRouter);
router.use(productsRouter);
router.use(searchRouter);
router.use(messagesRouter);
router.use(reviewsRouter);
router.use(pushTokensRouter);
router.use(storageRouter);
router.use(subscriptionsRouter);

export default router;
