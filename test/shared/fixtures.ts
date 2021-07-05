import { Contract, Wallet } from 'ethers'
import { Web3Provider } from 'ethers/providers'
import { deployContract } from 'ethereum-waffle'
import { MaxUint256 } from 'ethers/constants'

import ERC20 from '../../build/ERC20.json'
import WETH9 from '../../build/WETH9.json'
import NostraSwapFactory from '../../build/NostraSwapFactory.json'
import NostraSwapPair from '../../build/NostraSwapPair.json'
import ExternalNostraSwapFactory from '../../build/ExternalNostraSwapFactory.json'
import ExternalNostraSwapPair from '../../build/ExternalNostraSwapPair.json'
import TimeLock from '../../build/Timelock.json'
import { expandTo18Decimals } from './utilities'

interface FactoryFixture {
  factory: Contract
  externalFactory: Contract
  WETH: Contract
  tokenA: Contract
  tokenB: Contract
}

const overrides = {
  gasLimit: 9999999
}

export async function factoryFixture(provider: Web3Provider, [wallet]: Wallet[], owner: any = wallet.address): Promise<FactoryFixture> {
  const WETH = await deployContract(wallet, WETH9)
  await WETH.deposit({value: expandTo18Decimals(99999)})
  const externalFactory = await deployContract(wallet, ExternalNostraSwapFactory, [wallet.address, owner], overrides)
  const factory = await deployContract(wallet, NostraSwapFactory, [wallet.address, owner, WETH.address, externalFactory.address], overrides)
  const tokenA = await deployContract(wallet, ERC20, [MaxUint256], overrides)
  const tokenB = await deployContract(wallet, ERC20, [MaxUint256], overrides)
  
  await externalFactory.createPair(WETH.address, tokenA.address, overrides)
  let pairAddress = await externalFactory.getPair(WETH.address, tokenA.address)
  let pair = new Contract(pairAddress, JSON.stringify(ExternalNostraSwapPair.abi), provider).connect(wallet)
  
  await tokenA.transfer(pairAddress, expandTo18Decimals(100))
  await WETH.transfer(pairAddress, expandTo18Decimals(50))
  await pair.mint(wallet.address)

  await externalFactory.createPair(WETH.address, tokenB.address, overrides)
  pairAddress = await externalFactory.getPair(WETH.address, tokenB.address)
  pair = new Contract(pairAddress, JSON.stringify(ExternalNostraSwapPair.abi), provider).connect(wallet)
  
  await tokenB.transfer(pairAddress, expandTo18Decimals(100))
  await WETH.transfer(pairAddress, expandTo18Decimals(50))
  await pair.mint(wallet.address)
  return { factory, externalFactory, WETH, tokenA, tokenB }
}

interface PairFixture extends FactoryFixture {
  token0: Contract
  token1: Contract
  pair: Contract
  externalPair: Contract
}

interface TimeLockFixture extends PairFixture {
  timelock: Contract
}

export async function pairFixture(provider: Web3Provider, [wallet]: Wallet[]): Promise<PairFixture> {
  const { factory, externalFactory, WETH, tokenA, tokenB } = await factoryFixture(provider, [wallet])

  await factory.createPair(tokenA.address, overrides)
  const pairAddress = await factory.getPair(WETH.address, tokenA.address)
  const pair = new Contract(pairAddress, JSON.stringify(NostraSwapPair.abi), provider).connect(wallet)
  const externalPair = new Contract(await externalFactory.getPair(WETH.address, tokenA.address), JSON.stringify(ExternalNostraSwapPair.abi), provider).connect(wallet)

  const token0 = WETH
  const token1 = tokenA

  return { factory, externalFactory, WETH, tokenA, tokenB, token0, token1, pair, externalPair }
}

export async function timelockFixture(provider: Web3Provider, [wallet]: Wallet[]): Promise<TimeLockFixture> {
  const timelock = await deployContract(wallet, TimeLock, [wallet.address, 21600], overrides)
  const { factory, externalFactory, WETH, tokenA, tokenB } = await factoryFixture(provider, [wallet], timelock.address)

  await factory.createPair(tokenA.address, overrides)
  const pairAddress = await factory.getPair(WETH.address, tokenA.address)
  const pair = new Contract(pairAddress, JSON.stringify(NostraSwapPair.abi), provider).connect(wallet)
  const externalPair = new Contract(await externalFactory.getPair(WETH.address, tokenA.address), JSON.stringify(ExternalNostraSwapPair.abi), provider).connect(wallet)

  const token0 = WETH
  const token1 = tokenA

  return { factory, externalFactory, WETH, tokenA, tokenB, token0, token1, pair, externalPair, timelock }
}
